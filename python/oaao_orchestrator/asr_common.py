"""Shared ASR helpers — ffmpeg normalize, OpenAI-compatible transcription, glossary-aware polish."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.llm_model_info import fetch_openai_compat_model_limits
from oaao_orchestrator.polish_prompt import render_polish_user_message
from oaao_orchestrator.quick_punctuate import load_quick_punctuate_rules, quick_punctuate_transcript
from oaao_orchestrator.subprocess_pool import run_exec
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

# Fun-ASR-Nano emits inline control tokens: <|yue|>, <|NEUTRAL|>, <|Speech|>, <|woitn|>, …
_FUNASR_CONTROL_TOKEN_RE = re.compile(r"<\|[^|>]*\|>")
_FUNASR_LANG_TAG_RE = re.compile(r"<\|(zh|yue|ko|en|ja|nospeech)\|>", re.IGNORECASE)


def sanitize_asr_transcript_text(text: str) -> str:
    """Strip Fun-ASR-Nano language/emotion/modality control tokens from transcript text."""
    if not text:
        return text
    return _FUNASR_CONTROL_TOKEN_RE.sub("", text).strip()


def normalize_funasr_stream_language(language: str) -> str:
    """Normalize admin/user ASR language to FunASR Nano start payload (docs: ``yue`` for Cantonese)."""
    raw = (language or "").strip()
    if not raw:
        return "yue"
    key = raw.lower().replace("_", "-")
    aliases: dict[str, str] = {
        "yue": "yue",
        "cantonese": "yue",
        "粤语": "yue",
        "廣東話": "yue",
        "广东话": "yue",
        "zh-hk": "yue",
        "zh-hant": "yue",
        "zh": "auto",
        "中文": "auto",
        "zh-cn": "auto",
        "zh-hans": "auto",
        "mandarin": "auto",
        "普通话": "auto",
        "普通話": "auto",
        "en": "en",
        "english": "en",
        "英文": "en",
        "ja": "ja",
        "日语": "ja",
        "日文": "ja",
        "ko": "ko",
        "韩语": "ko",
        "韩文": "ko",
        "auto": "auto",
    }
    if key in aliases:
        return aliases[key]
    base = key.split("-", 1)[0]
    return aliases.get(base, raw)


def funasr_raw_lang_tag(raw: str) -> str:
    m = _FUNASR_LANG_TAG_RE.search(raw or "")
    return m.group(1).lower() if m else ""


def should_discard_funasr_stream_emit(raw: str, cleaned: str, *, is_final: bool) -> bool:
    """Drop SenseVoice partial hallucinations (e.g. <|ko|>그 on quiet Cantonese audio)."""
    if not cleaned:
        return True
    if is_final:
        return False
    lang = funasr_raw_lang_tag(raw)
    if lang in ("nospeech", "ko") and len(cleaned) <= 4:
        return True
    return False


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def glossary_prompt_string(glossary: dict[str, Any] | None, *, max_chars: int = 800) -> str:
    """Build Whisper-style prompt / hotword hint from merged glossary terms."""
    if not glossary or not isinstance(glossary, dict):
        return ""
    terms = glossary.get("terms")
    if not isinstance(terms, list):
        return ""
    parts: list[str] = []
    for raw in terms:
        if not isinstance(raw, dict):
            continue
        term = str(raw.get("term") or "").strip()
        if not term:
            continue
        aliases = raw.get("aliases")
        if isinstance(aliases, list):
            alias_s = ", ".join(str(a).strip() for a in aliases if str(a).strip())
            parts.append(f"{term} ({alias_s})" if alias_s else term)
        else:
            parts.append(term)
        if len(", ".join(parts)) >= max_chars:
            break
    out = ", ".join(parts)
    return out[:max_chars]


def openai_compat_transcriptions_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url.rstrip("/"))
    if bu.endswith("/audio/transcriptions"):
        return bu
    if bu.endswith("/v1"):
        return f"{bu}/audio/transcriptions"
    return f"{bu}/v1/audio/transcriptions"


def openai_compat_chat_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url.rstrip("/"))
    if bu.endswith("/chat/completions"):
        return bu
    if bu.endswith("/v1"):
        return f"{bu}/chat/completions"
    return f"{bu}/v1/chat/completions"


BATCH_PROTOCOL_OPENAI = "openai_compat"
BATCH_PROTOCOL_JSON = "json_transcribe"


def resolve_batch_protocol(asr_cfg: dict[str, Any] | None) -> str:
    """HTTP batch transcribe adapter — independent of live streaming provider."""
    if not isinstance(asr_cfg, dict):
        return BATCH_PROTOCOL_OPENAI
    explicit = (
        str(asr_cfg.get("batch_protocol") or asr_cfg.get("transcribe_protocol") or "")
        .strip()
        .lower()
    )
    if explicit in (BATCH_PROTOCOL_OPENAI, BATCH_PROTOCOL_JSON, "json", "nano_transcribe"):
        return (
            BATCH_PROTOCOL_JSON
            if explicit in (BATCH_PROTOCOL_JSON, "json", "nano_transcribe")
            else BATCH_PROTOCOL_OPENAI
        )
    provider = str(asr_cfg.get("provider") or "").strip().lower()
    if provider in ("funasr_nano", "funasr-nano", "funasr_nano_remote"):
        return BATCH_PROTOCOL_JSON
    return BATCH_PROTOCOL_OPENAI


def resolve_batch_http_base(asr_cfg: dict[str, Any]) -> str:
    """HTTP(S) base for batch transcribe — skips WebSocket stream URLs."""
    for key in ("funasr_base_url", "funasr_live_base_url", "base_url"):
        bu = str(asr_cfg.get(key) or "").strip()
        low = bu.lower()
        if low.startswith(("ws://", "wss://")):
            continue
        if bu and not bu.endswith("/audio/transcriptions"):
            return ensure_url_scheme(bu.rstrip("/"))
    return ""


def json_transcribe_url(base_url: str) -> str:
    bu = base_url.rstrip("/")
    if bu.endswith("/transcribe"):
        return bu
    return f"{bu}/transcribe"


def _extract_json_transcribe_text(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    for key in ("text", "transcript", "result", "output"):
        raw = body.get(key)
        if isinstance(raw, str) and raw.strip():
            cleaned = sanitize_asr_transcript_text(raw.strip())
            return cleaned or None
    data = body.get("data")
    if isinstance(data, dict):
        for key in ("text", "transcript"):
            raw = data.get(key)
            if isinstance(raw, str) and raw.strip():
                cleaned = sanitize_asr_transcript_text(raw.strip())
                return cleaned or None
    return None


async def transcribe_json_base64_file(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any],
) -> tuple[str | None, str | None]:
    """POST ``/transcribe`` with ``{input: base64, language, itn}`` — FunASR Nano–compatible, provider-agnostic."""
    path = Path(audio_path)
    if not path.is_file():
        return None, "audio_file_missing"

    base = resolve_batch_http_base(asr_cfg)
    if not base:
        return None, "asr_endpoint_missing"

    url = json_transcribe_url(base)
    language = str(asr_cfg.get("language") or "中文").strip() or "中文"
    itn = bool(asr_cfg.get("itn", asr_cfg.get("enable_itn", True)))

    try:
        raw_bytes = path.read_bytes()
    except OSError as exc:
        return None, str(exc)[:200]

    if len(raw_bytes) < 44:
        return None, "audio_too_short"

    b64 = base64.b64encode(raw_bytes).decode("ascii")
    payload = {"input": b64, "language": language, "itn": itn}

    try:
        file_size = len(raw_bytes)
        timeout_read = max(60.0, min(300.0, 30.0 + file_size / (256 * 1024)))
        r = await client.post(
            url,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=httpx.Timeout(timeout_read, connect=20.0),
        )
        if r.status_code >= 400:
            return None, f"json_transcribe_http_{r.status_code}:{r.text[:300]}"
        try:
            body = r.json()
        except ValueError:
            return None, "json_transcribe_invalid_json"
        text = _extract_json_transcribe_text(body)
        if text:
            return text, None
        return None, "json_transcribe_empty_response"
    except Exception as exc:  # noqa: BLE001
        logger.warning("transcribe_json_base64_file failed url=%s: %s", url, exc)
        return None, str(exc)[:400]


def has_batch_transcribe_config(asr_cfg: dict[str, Any] | None) -> bool:
    if not isinstance(asr_cfg, dict):
        return False
    if resolve_batch_http_base(asr_cfg):
        return True
    bu = str(asr_cfg.get("base_url") or asr_cfg.get("url") or "").strip()
    return bool(bu) and resolve_batch_protocol(asr_cfg) == BATCH_PROTOCOL_OPENAI


def _asr_max_upload_bytes() -> int:
    """ASR providers (OpenAI Whisper, Qwen ASR, …) commonly cap uploads at ~25 MiB."""
    raw = _env("OAAO_ASR_MAX_UPLOAD_MB", "24")
    try:
        mb = float(raw)
    except ValueError:
        mb = 24.0
    mb = max(1.0, min(mb, 100.0))
    return int(mb * 1024 * 1024)


# mono 16 kHz PCM s16le bytes per second (ffmpeg segment target format)
_WAV_MONO16K_BPS = 16000 * 2


def _audio_mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".opus": "audio/opus",
    }.get(ext, "application/octet-stream")


def _format_asr_http_error(status: int, body: str) -> str:
    low = body.lower()
    if status == 400 and ("file size" in low or "filesize" in low or "too large" in low):
        max_mb = _asr_max_upload_bytes() / (1024 * 1024)
        return f"asr_file_too_large (endpoint limit; chunks use ≤{max_mb:.0f} MiB)"
    return f"asr_http_{status}:{body[:300]}"


async def ffprobe_duration_sec(src_path: str) -> float | None:
    """Return media duration in seconds via ffprobe, or None."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(src_path),
    ]
    try:
        proc = await run_exec(
            cmd,
            lane="ffmpeg",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return None
        txt = (out or b"").decode(errors="replace").strip()
        if not txt:
            return None
        dur = float(txt)
        return dur if dur > 0 else None
    except (FileNotFoundError, ValueError, OSError):
        return None


def _env_float(name: str, default: str) -> float:
    raw = _env(name, default)
    try:
        v = float(raw)
    except ValueError:
        v = float(default)
    return v


def _resolve_chunk_buffers(asr_cfg: dict[str, Any] | None) -> tuple[float, float]:
    """
    Seconds of audio to include before/after each chunk core window (context overlap).

    Settings: purpose meta_json → job payload, or ``OAAO_ASR_CHUNK_BUFFER_SEC`` (symmetric default).
    """
    default_sym = max(0.0, min(120.0, _env_float("OAAO_ASR_CHUNK_BUFFER_SEC", "3")))
    cfg = asr_cfg if isinstance(asr_cfg, dict) else {}

    sym = cfg.get("chunk_buffer_sec", cfg.get("asr_chunk_buffer_sec", cfg.get("chunk_pad_sec")))
    if sym is not None:
        try:
            b = max(0.0, min(120.0, float(sym)))
        except (TypeError, ValueError):
            b = default_sym
        return b, b

    def _side(key: str, fallback: float) -> float:
        if key not in cfg or cfg.get(key) is None:
            return fallback
        try:
            return max(0.0, min(120.0, float(cfg[key])))
        except (TypeError, ValueError):
            return fallback

    before = _side("chunk_buffer_before_sec", default_sym)
    before = _side("chunk_pad_before_sec", before)
    before = _side("asr_chunk_buffer_before_sec", before)
    after = _side("chunk_buffer_after_sec", default_sym)
    after = _side("chunk_pad_after_sec", after)
    after = _side("asr_chunk_buffer_after_sec", after)
    return before, after


def _core_segment_seconds(
    max_upload_bytes: int, buffer_before: float, buffer_after: float
) -> float:
    """Core window length so padded extract (core + buffers) stays under upload cap."""
    max_dur = max_upload_bytes / _WAV_MONO16K_BPS
    pad = buffer_before + buffer_after
    if pad >= max_dur * 0.5:
        return max(30.0, max_dur * 0.45)
    core = max_dur * 0.85 - pad
    return max(60.0, core)


def _merge_transcription_prompts(
    glossary: dict[str, Any] | None,
    *,
    carry_prompt: str | None,
    max_chars: int = 800,
) -> str:
    parts: list[str] = []
    gp = glossary_prompt_string(glossary)
    if gp:
        parts.append(gp)
    if carry_prompt:
        tail = carry_prompt.strip()
        if tail:
            parts.append(tail[-400:])
    out = " ".join(parts).strip()
    return out[:max_chars]


async def ffmpeg_extract_wav_clip(
    src_path: str,
    *,
    start_sec: float,
    duration_sec: float,
    out_path: str,
) -> bool:
    if duration_sec <= 0.05:
        return False
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, start_sec):.3f}",
        "-i",
        str(src_path),
        "-t",
        f"{duration_sec:.3f}",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        out_path,
    ]
    try:
        proc = await run_exec(
            cmd,
            lane="ffmpeg",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "ffmpeg clip failed rc=%s: %s",
                proc.returncode,
                (err or b"")[:300].decode(errors="replace"),
            )
            return False
        return Path(out_path).is_file() and Path(out_path).stat().st_size > 44
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg clip error: %s", e)
        return False


async def ffmpeg_segment_wav_mono16k(
    src_path: str,
    max_upload_bytes: int,
    *,
    buffer_before_sec: float = 0.0,
    buffer_after_sec: float = 0.0,
) -> tuple[list[str], str | None]:
    """
    Split source audio into mono 16 kHz WAV segments each ≤ max_upload_bytes (approx).

    When buffer_* > 0, each segment includes pad audio before/after the core window so ASR
    sees cross-chunk context (merged transcript strips duplicate overlap heuristically).

    Returns (sorted chunk paths, temp directory to remove when done).
    """
    src = Path(src_path)
    if not src.is_file():
        return [], None

    total_dur = await ffprobe_duration_sec(str(src))
    if total_dur is None or total_dur <= 0:
        total_dur = None

    core_seg_time = _core_segment_seconds(max_upload_bytes, buffer_before_sec, buffer_after_sec)
    use_pad = buffer_before_sec > 0 or buffer_after_sec > 0

    out_dir = tempfile.mkdtemp(prefix="oaao_asr_chunks_")

    if not use_pad:
        pattern = str(Path(out_dir) / "chunk_%03d.wav")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "segment",
            "-segment_time",
            f"{core_seg_time:.3f}",
            "-reset_timestamps",
            "1",
            pattern,
        ]
        try:
            proc = await run_exec(
                cmd,
                lane="ffmpeg",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    "ffmpeg segment failed rc=%s: %s",
                    proc.returncode,
                    (err or b"")[:400].decode(errors="replace"),
                )
                _cleanup_chunk_dir(out_dir)
                return [], None
            chunks = sorted(str(p) for p in Path(out_dir).glob("chunk_*.wav") if p.is_file())
            if not chunks:
                _cleanup_chunk_dir(out_dir)
                return [], None
            return chunks, out_dir
        except Exception as e:  # noqa: BLE001
            logger.warning("ffmpeg segment error: %s", e)
            _cleanup_chunk_dir(out_dir)
            return [], None

    # Padded windows: [core_start - pad_before, core_end + pad_after] clipped to file duration.
    dur = total_dur if total_dur is not None else core_seg_time * 4
    chunks: list[str] = []
    core_start = 0.0
    idx = 0
    try:
        while core_start < dur - 0.05:
            core_end = min(dur, core_start + core_seg_time)
            extract_start = max(0.0, core_start - buffer_before_sec)
            extract_end = min(dur, core_end + buffer_after_sec)
            extract_dur = extract_end - extract_start
            est_bytes = int(extract_dur * _WAV_MONO16K_BPS)
            if est_bytes > max_upload_bytes and extract_dur > 0:
                extract_dur = max(30.0, (max_upload_bytes / _WAV_MONO16K_BPS) * 0.92)
                extract_end = min(dur, extract_start + extract_dur)

            out_path = str(Path(out_dir) / f"chunk_{idx:03d}.wav")
            ok = await ffmpeg_extract_wav_clip(
                str(src),
                start_sec=extract_start,
                duration_sec=extract_end - extract_start,
                out_path=out_path,
            )
            if not ok:
                break
            if Path(out_path).stat().st_size > max_upload_bytes:
                Path(out_path).unlink(missing_ok=True)
                break
            chunks.append(out_path)
            idx += 1
            if core_end >= dur - 0.05:
                break
            core_start = core_end

        if not chunks:
            _cleanup_chunk_dir(out_dir)
            return [], None
        return chunks, out_dir
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg padded segment error: %s", e)
        _cleanup_chunk_dir(out_dir)
        return [], None


def _cleanup_chunk_dir(chunk_dir: str | None, extra_paths: list[str] | None = None) -> None:
    if extra_paths:
        for p in extra_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
    if not chunk_dir:
        return
    try:
        for p in Path(chunk_dir).glob("*"):
            p.unlink(missing_ok=True)
        Path(chunk_dir).rmdir()
    except OSError:
        pass


async def ffmpeg_to_wav_mono16k(src_path: str) -> str | None:
    """Convert audio file to mono 16 kHz WAV; returns temp path or None."""
    src = Path(src_path)
    if not src.is_file():
        return None
    fd, out = tempfile.mkstemp(suffix=".wav", prefix="oaao_asr_")
    os.close(fd)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        out,
    ]
    try:
        proc = await run_exec(
            cmd,
            lane="ffmpeg",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "ffmpeg failed rc=%s: %s",
                proc.returncode,
                (err or b"")[:400].decode(errors="replace"),
            )
            Path(out).unlink(missing_ok=True)
            return None
        return out
    except FileNotFoundError:
        logger.warning("ffmpeg not found — install ffmpeg in orchestrator image")
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg error: %s", e)
        Path(out).unlink(missing_ok=True)
        return None


def _merge_chunk_transcripts(parts: list[str], buffer_before: float, buffer_after: float) -> str:
    """Join chunk transcripts; trim duplicate suffix/prefix when padded overlap was used."""
    cleaned = [p.strip() for p in parts if p and p.strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1 or (buffer_before <= 0 and buffer_after <= 0):
        return "\n\n".join(cleaned)

    merged = cleaned[0]
    for nxt in cleaned[1:]:
        prev = merged
        best = 0
        max_k = min(len(prev), len(nxt), 400)
        for k in range(max_k, 19, -1):
            if prev[-k:].strip().lower() == nxt[:k].strip().lower():
                best = k
                break
        if best > 0:  # noqa: SIM108
            merged = prev + nxt[best:].lstrip()
        else:
            merged = prev.rstrip() + "\n\n" + nxt.lstrip()
    return merged.strip()


async def transcribe_audio_file(
    client: httpx.AsyncClient,
    *,
    wav_or_audio_path: str,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
    carry_prompt: str | None = None,
) -> tuple[str | None, str | None]:
    """OpenAI-compatible multipart or JSON/base64 batch transcribe. Returns (text, error)."""
    if resolve_batch_protocol(asr_cfg) == BATCH_PROTOCOL_JSON:
        return await transcribe_json_base64_file(
            client,
            audio_path=wav_or_audio_path,
            asr_cfg=asr_cfg,
        )

    bu = str(asr_cfg.get("base_url") or "").strip()
    url_direct = str(asr_cfg.get("url") or "").strip()
    model = str(asr_cfg.get("model") or "").strip()
    if not model:
        return None, "asr_model_missing"
    if not url_direct and not bu:
        return None, "asr_endpoint_missing"

    api_key = _resolve_secret(
        asr_cfg.get("api_key_env") if isinstance(asr_cfg.get("api_key_env"), str) else None
    )
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_transcriptions_url(bu)
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    prompt = _merge_transcription_prompts(glossary, carry_prompt=carry_prompt)
    path = Path(wav_or_audio_path)
    if not path.is_file():
        return None, "audio_file_missing"

    data: dict[str, str] = {"model": model}
    if prompt:
        data["prompt"] = prompt

    try:
        file_size = path.stat().st_size
        timeout_read = max(180.0, min(900.0, 60.0 + file_size / (512 * 1024)))
        mime = _audio_mime_for_path(path)
        with path.open("rb") as fh:
            files = {"file": (path.name, fh, mime)}
            r = await client.post(
                url,
                headers=headers,
                data=data,
                files=files,
                timeout=httpx.Timeout(timeout_read, connect=15.0),
            )
        if r.status_code >= 400:
            return None, _format_asr_http_error(r.status_code, r.text[:400])
        body = r.json()
        if isinstance(body, dict):
            txt = body.get("text")
            if isinstance(txt, str) and txt.strip():
                return txt.strip(), None
        return None, "asr_empty_response"
    except Exception as e:  # noqa: BLE001
        return None, str(e)[:400]


async def transcribe_audio_auto(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    """
    Transcribe one file; split into ASR-sized WAV chunks when over {@see _asr_max_upload_bytes}.

    Returns (text, error, extra_meta).
    """
    extra: dict[str, Any] = {"chunked": False, "chunk_count": 0}
    src = Path(audio_path)
    if not src.is_file():
        return None, "audio_file_missing", extra

    max_b = _asr_max_upload_bytes()
    buf_before, buf_after = _resolve_chunk_buffers(asr_cfg)
    wav_path: str | None = None
    chunk_dir: str | None = None
    try:
        src_size = src.stat().st_size
        dur = await ffprobe_duration_sec(audio_path)
        est_wav_bytes = int(dur * _WAV_MONO16K_BPS) if dur else None
        need_chunk = src_size > max_b or (est_wav_bytes is not None and est_wav_bytes > max_b)

        if not need_chunk:
            wav_path = await ffmpeg_to_wav_mono16k(audio_path)
            transcribe_path = wav_path or audio_path
            if Path(transcribe_path).stat().st_size > max_b:
                need_chunk = True
            else:
                text, err = await transcribe_audio_file(
                    client,
                    wav_or_audio_path=transcribe_path,
                    asr_cfg=asr_cfg,
                    glossary=glossary,
                )
                return text, err, extra

        # Long audio — segment from source (avoid one oversized upload / temp WAV).
        chunks, chunk_dir = await ffmpeg_segment_wav_mono16k(
            audio_path,
            max_b,
            buffer_before_sec=buf_before,
            buffer_after_sec=buf_after,
        )
        if not chunks:
            return None, "asr_audio_too_large_segment_failed", extra

        extra["chunked"] = True
        extra["chunk_count"] = len(chunks)
        if buf_before > 0 or buf_after > 0:
            extra["chunk_buffer_before_sec"] = buf_before
            extra["chunk_buffer_after_sec"] = buf_after
        parts: list[str] = []
        carry: str | None = None
        for idx, chunk in enumerate(chunks):
            text, err = await transcribe_audio_file(
                client,
                wav_or_audio_path=chunk,
                asr_cfg=asr_cfg,
                glossary=glossary if idx == 0 else None,
                carry_prompt=carry if idx > 0 else None,
            )
            if not text:
                return None, err or f"transcription_failed_chunk_{idx + 1}", extra
            piece = text.strip()
            parts.append(piece)
            carry = piece[-400:] if piece else carry

        merged = _merge_chunk_transcripts(parts, buf_before, buf_after)
        if not merged:
            return None, "asr_empty_response", extra
        return merged, None, extra
    finally:
        if wav_path and wav_path != audio_path:
            Path(wav_path).unlink(missing_ok=True)
        _cleanup_chunk_dir(chunk_dir)


async def polish_transcript(
    client: httpx.AsyncClient,
    *,
    raw_text: str,
    polish_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """LLM polish pass for ASR output. Returns (polished, error)."""
    return await _polish_transcript_llm(
        client,
        raw_text=raw_text,
        polish_cfg=polish_cfg,
        glossary=glossary,
        system_extra="",
        user_sections=None,
    )


async def polish_transcript_with_live_refs(
    client: httpx.AsyncClient,
    *,
    asr_text: str,
    live_chunks: list[str],
    polish_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
    batch_chunks: list[str] | None = None,
) -> tuple[str | None, str | None]:
    """
    Reconcile batch ASR (~5 s segments) with live streaming chunks, then polish.

    When ``asr_text`` is empty, falls back to polishing merged live chunks only.
    """
    asr = (asr_text or "").strip()
    live = [str(c).strip() for c in live_chunks if c and str(c).strip()]
    batch = [str(c).strip() for c in (batch_chunks or []) if c and str(c).strip()]
    try:
        max_live = max(4, min(int(_env("OAAO_LIVE_POLISH_MAX_LIVE_CHUNKS", "12")), 64))
    except ValueError:
        max_live = 12
    if len(live) > max_live:
        live = live[-max_live:]
    if not batch and asr:
        batch = [asr]
    if not asr and batch:
        asr = _join_batch_segment_texts(batch)
    if not asr and not live:
        return None, "empty_transcript"
    if not asr:
        merged = max(live, key=len)
        return await polish_transcript(
            client, raw_text=merged, polish_cfg=polish_cfg, glossary=glossary
        )
    merged = merge_asr_transcripts_for_polish(
        asr_text=asr,
        batch_chunks=batch,
        live_chunks=live,
    )
    return await polish_transcript(
        client,
        raw_text=merged,
        polish_cfg=polish_cfg,
        glossary=glossary,
    )


def _join_batch_segment_texts(parts: list[str]) -> str:
    cleaned = [p.strip() for p in parts if p and str(p).strip()]
    return " ".join(cleaned).strip()


def _normalize_asr_compare(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").lower())


def merge_asr_transcripts_for_polish(
    *,
    asr_text: str,
    batch_chunks: list[str] | None = None,
    live_chunks: list[str] | None = None,
) -> str:
    """
    Merge batch (~5 s) and live streaming ASR into one transcript before LLM polish.

    Prefer the longest coherent source; live often extends batch with tail content.
    """
    batch = [str(c).strip() for c in (batch_chunks or []) if c and str(c).strip()]
    live = [str(c).strip() for c in (live_chunks or []) if c and str(c).strip()]
    asr = (asr_text or "").strip()
    if not asr and batch:
        asr = _join_batch_segment_texts(batch)
    if not live:
        return asr
    if not asr:
        return max(live, key=len)

    live_longest = max(live, key=len)
    live_joined = " ".join(live)
    candidates = [asr, live_longest, live_joined]
    best = max(candidates, key=len)

    norm_asr = _normalize_asr_compare(asr)
    norm_live = _normalize_asr_compare(live_longest)
    if len(live_longest) >= len(asr) and norm_live.startswith(norm_asr[: min(len(norm_asr), 24)]):
        return live_longest
    if len(live_longest) > len(asr) and len(live_longest) >= int(len(asr) * 0.85):
        return live_longest
    return best


POLISH_STYLES = ("professional", "natural", "concise")
DEFAULT_POLISH_STYLE = "natural"


def normalize_polish_style(style: str | None) -> str:
    raw = (style or DEFAULT_POLISH_STYLE).strip().lower()
    if raw in POLISH_STYLES:
        return raw
    return DEFAULT_POLISH_STYLE


def _polish_style_word(style: str | None) -> str:
    s = normalize_polish_style(style)
    if s == "professional":
        return "formal"
    if s == "concise":
        return "concise"
    return "natural"


def normalize_polish_locale(language: str) -> str:
    """Canonical polish locale tag (zh-Hant / zh-Hans / en / passthrough)."""
    raw = (language or "en").strip().lower().replace("_", "-")
    if raw in ("zh-tw", "zh-hk", "zh-hant"):
        return "zh-Hant"
    if raw in ("zh-cn", "zh-hans") or raw == "zh":
        return "zh-Hans"
    if raw.startswith("en"):
        return "en"
    return (language or "en").strip()


def polish_locale_label(language: str) -> str:
    return normalize_polish_locale(language) if language else "en"


def build_polish_user_task(locale: str, polish_style: str | None = None) -> str:
    """Render template prompt without transcript (inspection / tests)."""
    return render_polish_user_message(
        locale=polish_locale_label(locale) if locale else "the user's display language",
        style=_polish_style_word(polish_style),
        raw="",
    )


def build_polish_user_content(
    *,
    raw: str,
    locale: str,
    polish_style: str | None,
    gloss_blob: str = "",
    template_ref: str = "",
) -> str:
    """Assemble user message from markdown template prompt + transcript."""
    style_word = _polish_style_word(polish_style)
    loc = polish_locale_label(locale) if locale else "the user's display language"
    msg = render_polish_user_message(
        locale=loc,
        style=style_word,
        raw=raw,
        template_ref=template_ref,
    )
    if gloss_blob:
        msg += f"\n\nGlossary JSON:\n{gloss_blob}"
    return msg


def extract_polish_llm_content(text: str) -> str:
    """Keep one paragraph when the model returns headings or multiple versions."""
    t = (text or "").strip()
    if not t:
        return t
    skip = re.compile(
        r"^(#{1,3}\s|版本\s*\d|Version\s*\d|\*\*|【|---|"
        r"[【\[]?(专业|專業|自然|简洁|簡潔|Recommended|推薦))",
        re.IGNORECASE,
    )
    body: list[str] = []
    for ln in t.splitlines():
        line = ln.strip()
        if not line or skip.match(line):
            continue
        body.append(line)
    if not body:
        return t
    if len(body) == 1:
        return body[0]
    if all(len(x) <= 120 for x in body):
        return "".join(body)
    return " ".join(body)


def build_polish_system_prompt(
    *,
    locale: str = "",
    system_extra: str = "",
) -> str:
    """No system prompt — the user-message one-liner carries everything the LLM needs.

    Matches the user's proven minimal direct-chat prompt that produces excellent output.
    """
    return (system_extra or "").strip()


def _polish_llm_timeout_sec(polish_cfg: dict[str, Any]) -> float:
    raw = polish_cfg.get("timeout_sec")
    if raw is not None:
        try:
            return max(1.0, min(float(raw), 30.0))
        except (TypeError, ValueError):
            pass
    return max(1.0, min(float(_env("OAAO_LIVE_POLISH_LLM_TIMEOUT_SEC", "12")), 30.0))


def _default_polish_output_cap() -> int:
    try:
        return max(64, min(int(_env("OAAO_LIVE_POLISH_MAX_OUTPUT_TOKENS", "256")), 512))
    except ValueError:
        return 256


def _polish_output_hard_cap() -> int:
    """Voice ASR polish — Gemma/vLLM hosts hang on large max_tokens (512+)."""
    return _default_polish_output_cap()


def estimate_text_tokens(text: str) -> int:
    """Conservative token estimate for CJK-heavy ASR transcripts."""
    if not text:
        return 0
    return max(1, (len(text) + 1) // 2)


def _trim_polish_user_content(user_content: str, *, max_chars: int) -> str:
    """Truncate from the head if oversized, preserving the trailing transcript."""
    if len(user_content) <= max_chars:
        return user_content
    return user_content[-max_chars:]


async def _resolve_polish_context_len(
    client: httpx.AsyncClient,
    polish_cfg: dict[str, Any],
    *,
    base_url: str,
    model: str,
    api_key: str | None,
) -> int:
    raw = polish_cfg.get("max_model_len")
    if raw is not None:
        try:
            return max(256, min(int(raw), 131072))
        except (TypeError, ValueError):
            pass
    skip_probe = _env("OAAO_LIVE_POLISH_SKIP_MODEL_PROBE", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if skip_probe:
        try:
            return max(256, min(int(_env("OAAO_LIVE_POLISH_DEFAULT_CONTEXT_LEN", "8192")), 131072))
        except ValueError:
            return 8192
    limits = await fetch_openai_compat_model_limits(
        client,
        base_url=base_url,
        model=model,
        api_key=api_key,
    )
    ml = limits.get("max_model_len")
    if ml is not None:
        try:
            return max(256, min(int(ml), 131072))
        except (TypeError, ValueError):
            pass
    try:
        return max(256, min(int(_env("OAAO_LIVE_POLISH_DEFAULT_CONTEXT_LEN", "8192")), 131072))
    except ValueError:
        return 8192


def _resolve_polish_max_output_tokens(
    raw_len: int,
    polish_cfg: dict[str, Any],
    *,
    prompt_tokens: int = 0,
    context_len: int | None = None,
) -> int:
    """Cap polish completion tokens — respect host context window and configured caps."""
    desired: int | None = None
    for key in ("max_output_tokens", "max_tokens"):
        raw_cfg = polish_cfg.get(key)
        if raw_cfg is not None:
            try:
                desired = max(16, min(int(raw_cfg), 8192))
                break
            except (TypeError, ValueError):
                break
    if desired is None:
        hard_cap = _polish_output_hard_cap()
        desired = min(max(raw_len + 96, 128), hard_cap)

    desired = min(desired, _polish_output_hard_cap())

    if context_len is not None and context_len > 0:
        margin = 48
        budget = context_len - prompt_tokens - margin
        if budget < 64:
            budget = 64
        desired = min(desired, budget)
    return max(16, desired)


def _polish_http_error(status: int, raw: str) -> str:
    snippet = ""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict):
                snippet = str(err.get("message") or "").strip()[:160]
            elif isinstance(err, str):
                snippet = err.strip()[:160]
    except (json.JSONDecodeError, TypeError):
        snippet = raw.strip().replace("\n", " ")[:160]
    if snippet:
        return f"polish_http_{status}:{snippet}"
    return f"polish_http_{status}"


async def _post_polish_chat_completion(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    timeout_sec: float,
) -> httpx.Response:
    """POST chat/completions; on max_tokens 400, retry once with a smaller cap."""
    hard_cap = _polish_output_hard_cap()
    base_cap = body.get("max_tokens")
    if isinstance(base_cap, int) and base_cap > 0:
        first = min(base_cap, hard_cap)
        caps = [first]
        if first > 128:
            caps.append(128)
    else:
        caps = [hard_cap, 128]

    last: httpx.Response | None = None
    seen: set[int] = set()
    read_timeout = max(5.0, float(timeout_sec))
    httpx_timeout = httpx.Timeout(connect=min(3.0, read_timeout), read=read_timeout, write=10.0, pool=5.0)
    for cap in caps:
        if cap in seen:
            continue
        seen.add(cap)
        attempt = dict(body)
        attempt["max_tokens"] = cap
        last = await client.post(
            url,
            headers=headers,
            json=attempt,
            timeout=httpx_timeout,
        )
        if last.status_code < 400:
            return last
        if last.status_code == 400 and (
            "max_tokens" in last.text.lower() or "context length" in last.text.lower()
        ):
            continue
        break
    assert last is not None
    return last


async def _polish_transcript_llm(
    client: httpx.AsyncClient,
    *,
    raw_text: str,
    polish_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
    system_extra: str = "",
    user_sections: list[str] | None = None,  # kept for backward compat; ignored
) -> tuple[str | None, str | None]:
    """Shared LLM polish call. Returns (polished, error).

    Mirrors the user's proven minimal direct-chat prompt:
    user message = `<one-line task>: "<raw>"`. No system prompt, no extra knobs.
    """
    del user_sections  # legacy parameter — merged transcript is already provided as raw_text
    raw = (raw_text or "").strip()
    if not raw:
        return None, "empty_transcript"

    bu = str(polish_cfg.get("base_url") or "").strip()
    url_direct = str(polish_cfg.get("url") or "").strip()
    model = str(polish_cfg.get("model") or "").strip()
    if not model or (not url_direct and not bu):
        return quick_punctuate_transcript(raw), "polish_not_configured"

    api_key = _resolve_secret(
        polish_cfg.get("api_key_env") if isinstance(polish_cfg.get("api_key_env"), str) else None
    )
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    locale = str(polish_cfg.get("locale") or polish_cfg.get("display_locale") or "").strip()
    polish_style = normalize_polish_style(
        str(polish_cfg.get("polish_style") or DEFAULT_POLISH_STYLE)
    )

    gloss_blob = ""
    if glossary:
        try:
            gloss_blob = json.dumps(glossary, ensure_ascii=False)[:6000]
        except (TypeError, ValueError):
            gloss_blob = ""

    system = build_polish_system_prompt(locale=locale, system_extra=system_extra)
    user_content = build_polish_user_content(
        raw=raw,
        locale=locale,
        polish_style=polish_style,
        gloss_blob=gloss_blob,
    )

    timeout_sec = _polish_llm_timeout_sec(polish_cfg)
    context_len = await _resolve_polish_context_len(
        client,
        polish_cfg,
        base_url=bu,
        model=model,
        api_key=api_key,
    )
    min_output = 128
    margin = 48
    max_user_tokens = context_len - estimate_text_tokens(system) - min_output - margin
    max_user_chars = max(256, max_user_tokens * 2)
    user_content = _trim_polish_user_content(user_content, max_chars=max_user_chars)
    prompt_tokens = estimate_text_tokens(system) + estimate_text_tokens(user_content)
    max_out = _resolve_polish_max_output_tokens(
        max(len(raw), len(user_content)),
        polish_cfg,
        prompt_tokens=prompt_tokens,
        context_len=context_len,
    )
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user_content})
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "stream": False,
        "max_tokens": max_out,
    }
    try:
        r = await _post_polish_chat_completion(
            client,
            url=url,
            headers=headers,
            body=body,
            timeout_sec=timeout_sec,
        )
        if r.status_code >= 400:
            return quick_punctuate_transcript(raw), _polish_http_error(r.status_code, r.text)
        data = r.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str) and c.strip():
                    return extract_polish_llm_content(c.strip()), None
        return quick_punctuate_transcript(raw), "polish_empty_response"
    except httpx.TimeoutException:
        return quick_punctuate_transcript(raw), "polish_timeout"
    except Exception as e:  # noqa: BLE001
        return quick_punctuate_transcript(raw), str(e)[:200]


async def run_asr_pipeline_on_file(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any] | None,
    polish_cfg: dict[str, Any] | None,
    glossary: dict[str, Any] | None = None,
    polish_enabled: bool = True,
) -> tuple[str | None, dict[str, Any]]:
    """
    ffmpeg → ASR → optional polish.

    Returns (final_text, meta dict with raw_text, polished flag, errors).
    """
    meta: dict[str, Any] = {"raw_text": "", "polished": False}
    if not asr_cfg or not isinstance(asr_cfg, dict):
        return None, {**meta, "error": "asr_config_missing"}

    try:
        from oaao_orchestrator.asr_funasr import is_speaker_mode, transcribe_funasr_speaker

        if is_speaker_mode(asr_cfg):
            raw, err, speaker_extra = await transcribe_funasr_speaker(
                client,
                audio_path=audio_path,
                asr_cfg=asr_cfg,
                glossary=glossary,
            )
            meta.update(speaker_extra)
            meta["chunked"] = False
            meta["chunk_count"] = 0
            if not raw:
                return None, {**meta, "error": err or "transcription_failed"}
            meta["raw_text"] = raw
            # Speaker Mode: skip LLM polish to preserve segment boundaries (P0).
            return raw, meta

        raw, err, asr_extra = await transcribe_audio_auto(
            client,
            audio_path=audio_path,
            asr_cfg=asr_cfg,
            glossary=glossary,
        )
        if asr_extra.get("chunked"):
            meta["chunked"] = True
            meta["chunk_count"] = asr_extra.get("chunk_count", 0)
            if asr_extra.get("chunk_buffer_before_sec") is not None:
                meta["chunk_buffer_before_sec"] = asr_extra.get("chunk_buffer_before_sec")
            if asr_extra.get("chunk_buffer_after_sec") is not None:
                meta["chunk_buffer_after_sec"] = asr_extra.get("chunk_buffer_after_sec")
        if not raw:
            return None, {**meta, "error": err or "transcription_failed"}
        meta["raw_text"] = raw

        final = raw
        if polish_enabled and polish_cfg and isinstance(polish_cfg, dict):
            polished, perr = await polish_transcript(
                client,
                raw_text=raw,
                polish_cfg=polish_cfg,
                glossary=glossary,
            )
            if polished:
                final = polished
                meta["polished"] = polished != raw
            if perr:
                meta["polish_error"] = perr

        return final, meta
    except Exception as e:  # noqa: BLE001
        logger.warning("run_asr_pipeline_on_file: %s", e)
        return None, {**meta, "error": str(e)[:400]}
