"""FunASR local HTTP client — Speaker Mode (diarization + structured segments)."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.asr_common import _audio_mime_for_path, ffprobe_duration_sec
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def is_speaker_mode(asr_cfg: dict[str, Any] | None) -> bool:
    """True when job payload requests FunASR diarization (Speaker Mode)."""
    if not asr_cfg or not isinstance(asr_cfg, dict):
        return False
    provider = str(asr_cfg.get("provider") or "openai_compat").strip().lower()
    if provider != "funasr":
        return False
    return bool(asr_cfg.get("diarization_enabled"))


def _resolve_funasr_base_url(asr_cfg: dict[str, Any]) -> str:
    for key in ("funasr_base_url", "base_url"):
        bu = str(asr_cfg.get(key) or "").strip()
        if bu:
            return ensure_url_scheme(bu.rstrip("/"))
    env = _env("OAAO_FUNASR_BASE_URL")
    if env:
        return ensure_url_scheme(env.rstrip("/"))
    return ""


def funasr_transcribe_url(base_url: str) -> str:
    bu = base_url.rstrip("/")
    for suffix in ("/v1/transcribe", "/api/v1/transcribe", "/v1/audio/transcriptions"):
        if bu.endswith(suffix):
            return bu
    return f"{bu}/v1/transcribe"


def speaker_label(speaker_id: int) -> str:
    return f"Speaker {speaker_id + 1}"


def format_timestamp_hms(begin_ms: int) -> str:
    total_sec = max(0, begin_ms // 1000)
    h = total_sec // 3600
    m = (total_sec % 3600) // 60
    s = total_sec % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def _coerce_ms(raw: Any, *, fallback_end: int | None = None) -> int | None:
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v < 0:
        return None
    # Heuristic: values under 10_000 on long clips are likely seconds.
    if v < 10_000 and (fallback_end is None or fallback_end > 600):
        v *= 1000.0
    return int(round(v))


def _coerce_speaker_id(raw: Any) -> int:
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, sid)


def extract_sentences_from_response(body: Any) -> list[dict[str, Any]]:
    """
    Parse FunASR / DashScope Fun-ASR filetrans-like JSON into normalized sentence dicts.

    Accepts:
    - ``output.transcripts[].sentences[]``
    - ``transcripts[].sentences[]``
    - top-level ``sentences[]``
    """
    if not isinstance(body, dict):
        return []

    candidates: list[Any] = []
    output = body.get("output")
    if isinstance(output, dict):
        candidates.append(output.get("transcripts"))
        candidates.append(output.get("results"))
    candidates.append(body.get("transcripts"))
    candidates.append(body.get("results"))

    sentences: list[dict[str, Any]] = []
    for block in candidates:
        if not isinstance(block, list):
            continue
        for tr in block:
            if not isinstance(tr, dict):
                continue
            sents = tr.get("sentences")
            if isinstance(sents, list):
                for s in sents:
                    if isinstance(s, dict):
                        sentences.append(s)
        if sentences:
            break

    if not sentences:
        top = body.get("sentences")
        if isinstance(top, list):
            sentences = [s for s in top if isinstance(s, dict)]

    return sentences


def pseudo_diarize_plain_text(
    text: str,
    *,
    duration_sec: float | None,
    speaker_count: int = 4,
) -> list[dict[str, Any]]:
    """
    Split a flat ASR transcript into pseudo speaker sentences.

    Used when FunASR adapter runs in stub mode but the configured ASR endpoint
    can still produce accurate text (OpenAI-compatible Whisper, etc.).
    """
    raw = text.strip()
    if not raw:
        return []

    parts = re.split(r"(?<=[。！？!?\.])\s*|\n+", raw)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        parts = [raw]

    sc = max(2, min(100, speaker_count))
    dur_ms = int((duration_sec or max(60.0, len(raw) / 8.0)) * 1000)
    total_chars = sum(len(p) for p in parts) or 1

    sentences: list[dict[str, Any]] = []
    t = 0
    for i, part in enumerate(parts):
        weight = len(part) / total_chars
        span = max(400, int(dur_ms * weight))
        begin = t
        end = min(dur_ms, t + span) if i < len(parts) - 1 else dur_ms
        sentences.append(
            {
                "text": part,
                "begin_time": begin,
                "end_time": max(begin + 300, end),
                "speaker_id": i % sc,
            }
        )
        t = end

    if sentences:
        sentences[-1]["end_time"] = dur_ms

    return sentences


def build_speaker_artifacts(
    sentences: list[dict[str, Any]],
    *,
    duration_sec: float | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    """
    Build segments[], speakers[] summary, and flat source_text for embed.

    Returns (segments, speakers, source_text).
    """
    segments: list[dict[str, Any]] = []
    speaker_stats: dict[int, dict[str, int]] = {}

    for raw in sentences:
        text = str(raw.get("text") or raw.get("sentence") or "").strip()
        if not text:
            continue
        sid = _coerce_speaker_id(raw.get("speaker_id", raw.get("speaker", 0)))
        begin_ms = _coerce_ms(raw.get("begin_time", raw.get("start_time", raw.get("start"))))
        end_ms = _coerce_ms(
            raw.get("end_time", raw.get("stop_time", raw.get("end"))),
            fallback_end=begin_ms,
        )
        if begin_ms is None:
            begin_ms = segments[-1]["end_ms"] if segments else 0
        if end_ms is None or end_ms < begin_ms:
            end_ms = begin_ms + max(500, len(text) * 80)

        label = speaker_label(sid)
        segments.append(
            {
                "speaker_id": sid,
                "speaker_label": label,
                "begin_ms": begin_ms,
                "end_ms": end_ms,
                "text": text,
            }
        )
        st = speaker_stats.setdefault(sid, {"utterance_count": 0, "total_ms": 0})
        st["utterance_count"] += 1
        st["total_ms"] += max(0, end_ms - begin_ms)

    segments.sort(key=lambda s: (s["begin_ms"], s["speaker_id"]))

    speakers: list[dict[str, Any]] = []
    for sid in sorted(speaker_stats.keys()):
        st = speaker_stats[sid]
        speakers.append(
            {
                "speaker_id": sid,
                "label": speaker_label(sid),
                "utterance_count": st["utterance_count"],
                "total_ms": st["total_ms"],
            }
        )

    lines = [
        f"[{format_timestamp_hms(seg['begin_ms'])}] {seg['speaker_label']}: {seg['text']}"
        for seg in segments
    ]
    source_text = "\n".join(lines).strip()

    if duration_sec is not None and duration_sec > 0 and segments:
        # Normalize if provider returned relative seconds only on short clips.
        max_end_ms = max(s["end_ms"] for s in segments)
        if max_end_ms < int(duration_sec * 500):
            scale = (duration_sec * 1000.0) / max(max_end_ms, 1)
            if scale > 1.5:
                for seg in segments:
                    seg["begin_ms"] = int(seg["begin_ms"] * scale)
                    seg["end_ms"] = int(seg["end_ms"] * scale)
                for sp in speakers:
                    sp["total_ms"] = int(sp["total_ms"] * scale)
                lines = [
                    f"[{format_timestamp_hms(seg['begin_ms'])}] {seg['speaker_label']}: {seg['text']}"
                    for seg in segments
                ]
                source_text = "\n".join(lines).strip()

    return segments, speakers, source_text


async def transcribe_funasr_speaker(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    """
    Whole-file FunASR transcription with diarization (no 24 MiB chunk merge).

    Returns (source_text, error, meta) where meta includes segments and speakers.
    """
    extra: dict[str, Any] = {
        "mode": "speaker",
        "provider": "funasr",
        "chunked": False,
        "chunk_count": 0,
        "segments": [],
        "speakers": [],
    }

    base = _resolve_funasr_base_url(asr_cfg)
    if not base:
        return None, "funasr_base_url_missing", extra

    path = Path(audio_path)
    if not path.is_file():
        return None, "audio_file_missing", extra

    url = funasr_transcribe_url(base)
    model = str(asr_cfg.get("model") or "").strip()
    data: dict[str, str] = {
        "diarization_enabled": "true",
    }
    if model:
        data["model"] = model
    if asr_cfg.get("enable_itn") is not None:
        data["enable_itn"] = "true" if asr_cfg.get("enable_itn") else "false"

    speaker_count = asr_cfg.get("speaker_count")
    if speaker_count is not None:
        try:
            sc = int(speaker_count)
            if 2 <= sc <= 100:
                data["speaker_count"] = str(sc)
                extra["speaker_count_hint"] = sc
        except (TypeError, ValueError):
            pass

    lang_hints = asr_cfg.get("language_hints")
    if isinstance(lang_hints, list) and lang_hints:
        try:
            data["language_hints"] = json.dumps([str(h) for h in lang_hints])
        except (TypeError, ValueError):
            pass

    terms = glossary.get("terms") if isinstance(glossary, dict) else None
    if isinstance(terms, list) and terms:
        hotwords: list[str] = []
        for raw in terms:
            if not isinstance(raw, dict):
                continue
            term = str(raw.get("term") or "").strip()
            if term:
                hotwords.append(term)
        if hotwords:
            data["hotwords"] = json.dumps(hotwords[:200])

    duration_sec = await ffprobe_duration_sec(audio_path)
    if duration_sec is not None:
        extra["duration_sec"] = round(duration_sec, 3)

    try:
        file_size = path.stat().st_size
        timeout_read = max(300.0, min(7200.0, 120.0 + file_size / (256 * 1024)))
        mime = _audio_mime_for_path(path)
        with path.open("rb") as fh:
            files = {"file": (path.name, fh, mime)}
            r = await client.post(
                url,
                data=data,
                files=files,
                timeout=httpx.Timeout(timeout_read, connect=30.0),
            )
        if r.status_code >= 400:
            return None, f"funasr_http_{r.status_code}:{r.text[:300]}", extra

        try:
            body = r.json()
        except json.JSONDecodeError:
            return None, "funasr_invalid_json", extra

        adapter_mode = str(body.get("adapter_mode") or "").lower() if isinstance(body, dict) else ""
        sentences = extract_sentences_from_response(body)

        sc_hint = 4
        if speaker_count is not None:
            try:
                sc_hint = max(2, min(100, int(speaker_count)))
            except (TypeError, ValueError):
                sc_hint = 4

        if adapter_mode == "stub":
            from oaao_orchestrator.asr_common import transcribe_audio_auto

            openai_text, oerr, _ = await transcribe_audio_auto(
                client,
                audio_path=audio_path,
                asr_cfg=asr_cfg,
                glossary=glossary,
            )
            if openai_text and not oerr:
                sentences = pseudo_diarize_plain_text(
                    openai_text,
                    duration_sec=duration_sec,
                    speaker_count=sc_hint,
                )
                extra["pseudo_diarization"] = True
                extra["openai_text_fallback"] = True
                logger.info(
                    "funasr stub + openai fallback: pseudo segments=%s chars=%s",
                    len(sentences),
                    len(openai_text),
                )

        if not sentences:
            # Fallback: flat text field (no diarization structure).
            flat = ""
            if isinstance(body, dict):
                for key in ("text", "transcript", "result"):
                    val = body.get(key)
                    if isinstance(val, str) and val.strip():
                        flat = val.strip()
                        break
            if not flat:
                return None, "funasr_empty_response", extra
            sid = 0
            begin_ms = 0
            end_ms = int((duration_sec or 0) * 1000) if duration_sec else max(1000, len(flat) * 80)
            sentences = [
                {
                    "speaker_id": sid,
                    "begin_time": begin_ms,
                    "end_time": end_ms,
                    "text": flat,
                }
            ]

        segments, speakers, source_text = build_speaker_artifacts(
            sentences,
            duration_sec=duration_sec,
        )
        if not source_text:
            return None, "funasr_empty_transcript", extra

        extra["segments"] = segments
        extra["speakers"] = speakers
        extra["raw_text"] = source_text
        extra["speaker_count"] = len(speakers)
        logger.info(
            "funasr speaker mode: segments=%s speakers=%s chars=%s",
            len(segments),
            len(speakers),
            len(source_text),
        )
        return source_text, None, extra
    except Exception as e:  # noqa: BLE001
        logger.warning("transcribe_funasr_speaker: %s", e)
        return None, str(e)[:400], extra
