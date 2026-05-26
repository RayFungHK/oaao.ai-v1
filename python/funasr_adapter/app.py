"""Minimal FunASR HTTP adapter — POST /v1/transcribe for oaao orchestrator Speaker Mode."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="oaao FunASR adapter", version="0.1.0")


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


async def ffprobe_duration_sec(path: Path) -> float | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return None
        txt = (out or b"").decode(errors="replace").strip()
        dur = float(txt)
        return dur if dur > 0 else None
    except (FileNotFoundError, ValueError, OSError):
        return None


def _speaker_label(speaker_id: int) -> str:
    return f"Speaker {speaker_id + 1}"


def build_stub_sentences(
    duration_sec: float,
    *,
    speaker_count: int = 4,
    language_hints: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Deterministic stub diarization for local dev without GPU FunASR."""
    langs = language_hints or []
    yue = any(h in {"yue", "zh", "zh-hant", "cantonese"} for h in langs)
    templates = (
        [
            "各位早晨，我哋開始今日嘅會議。",
            "首先確認 OTC 交易邏輯同價格定義。",
            "呢部分需要同風控團隊再對一對。",
            "無問題，我哋跟進下一個 agenda。",
            "多謝，今日討論到此為止。",
        ]
        if yue
        else [
            "Good morning — let's begin the meeting.",
            "First we confirm OTC trade logic and price definitions.",
            "Risk will review the edge cases offline.",
            "Agreed — moving to the next agenda item.",
            "Thanks everyone, we will follow up async.",
        ]
    )

    sc = max(2, min(100, speaker_count))
    window = max(8.0, min(45.0, duration_sec / max(6, sc * 2)))
    sentences: list[dict[str, Any]] = []
    t = 0.0
    idx = 0
    if duration_sec < 1.0:
        duration_sec = max(duration_sec, 1.0)
    while t < duration_sec - 0.5:
        end = min(duration_sec, t + window)
        sid = idx % sc
        text = templates[idx % len(templates)]
        sentences.append(
            {
                "text": text,
                "begin_time": int(round(t * 1000)),  # noqa: RUF046
                "end_time": int(round(end * 1000)),  # noqa: RUF046
                "speaker_id": sid,
            }
        )
        t = end
        idx += 1
    if not sentences and duration_sec > 0:
        sentences.append(
            {
                "text": templates[0],
                "begin_time": 0,
                "end_time": int(round(min(duration_sec, 1.0) * 1000)),  # noqa: RUF046
                "speaker_id": 0,
            }
        )
    return sentences


def wrap_dashscope_response(sentences: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "output": {
            "transcripts": [
                {
                    "sentences": sentences,
                }
            ]
        }
    }


def run_funasr_pipeline(
    audio_path: Path,
    *,
    model: str,
    diarization_enabled: bool,
    speaker_count: int | None,
    language_hints: list[str] | None,
) -> list[dict[str, Any]]:
    """
    Optional real FunASR path when the Python package + models are installed.

    Falls back to stub sentences when AutoModel is unavailable.
    """
    try:
        from funasr import AutoModel  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("funasr package not installed — stub fallback")
        return []

    asr_model = model or _env("FUNASR_ASR_MODEL", "paraformer-zh")
    spk_model = _env("FUNASR_SPK_MODEL", "")

    kwargs: dict[str, Any] = {"model": asr_model}
    if diarization_enabled and spk_model:
        kwargs["vad_model"] = _env("FUNASR_VAD_MODEL", "fsmn-vad")
        kwargs["punc_model"] = _env("FUNASR_PUNC_MODEL", "ct-punc")
        kwargs["spk_model"] = spk_model

    try:
        m = AutoModel(**kwargs)
        res = m.generate(input=str(audio_path), batch_size_s=300)
    except Exception as e:  # noqa: BLE001
        logger.warning("FunASR generate failed: %s", e)
        return []

    sentences: list[dict[str, Any]] = []
    if not isinstance(res, list):
        return sentences

    for block in res:
        if not isinstance(block, dict):
            continue
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        begin = block.get("start", block.get("begin_time", 0))
        end = block.get("end", block.get("end_time", begin))
        sid = block.get("spk", block.get("speaker_id", 0))
        try:
            begin_ms = int(float(begin) * 1000) if float(begin) < 10_000 else int(float(begin))
            end_ms = int(float(end) * 1000) if float(end) < 10_000 else int(float(end))
            speaker_id = int(sid)
        except (TypeError, ValueError):
            begin_ms, end_ms, speaker_id = 0, max(1000, len(text) * 80), 0
        sentences.append(
            {
                "text": text,
                "begin_time": begin_ms,
                "end_time": end_ms,
                "speaker_id": max(0, speaker_id),
            }
        )

    if speaker_count is not None and sentences:
        sc = max(2, min(100, speaker_count))
        for seg in sentences:
            seg["speaker_id"] = int(seg.get("speaker_id", 0)) % sc

    return sentences


@app.get("/health")
async def health() -> dict[str, str]:
    spk = _env("FUNASR_SPK_MODEL", "")
    body: dict[str, str] = {"status": "ok", "mode": _env("FUNASR_ADAPTER_MODE", "stub")}
    if spk:
        body["spk_model"] = spk
    return body


@app.post("/v1/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    diarization_enabled: str = Form(default="true"),
    model: str = Form(default=""),
    speaker_count: str = Form(default=""),
    language_hints: str = Form(default=""),
    enable_itn: str = Form(default="true"),
    hotwords: str = Form(default=""),
) -> JSONResponse:
    del enable_itn, hotwords  # reserved for future ITN / hotword biasing

    mode = _env("FUNASR_ADAPTER_MODE", "stub").lower()
    diar = _truthy(diarization_enabled)

    hints: list[str] = []
    if language_hints.strip():
        try:
            parsed = json.loads(language_hints)
            if isinstance(parsed, list):
                hints = [str(x).strip().lower() for x in parsed if str(x).strip()]
        except json.JSONDecodeError:
            hints = [language_hints.strip().lower()]

    sc: int | None = None
    if speaker_count.strip().isdigit():
        n = int(speaker_count.strip())
        if 2 <= n <= 100:
            sc = n

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    fd, tmp_name = tempfile.mkstemp(suffix=suffix, prefix="funasr_in_")
    os.close(fd)
    tmp_path = Path(tmp_name)

    try:
        data = await file.read()
        if not data:
            return JSONResponse({"error": "empty_file"}, status_code=400)
        tmp_path.write_bytes(data)

        dur = await ffprobe_duration_sec(tmp_path)
        if dur is None:
            dur = 120.0

        sentences: list[dict[str, Any]] = []
        if mode == "pipeline":
            sentences = await asyncio.to_thread(
                run_funasr_pipeline,
                tmp_path,
                model=model.strip(),
                diarization_enabled=diar,
                speaker_count=sc,
                language_hints=hints,
            )

        if not sentences:
            sentences = build_stub_sentences(
                dur,
                speaker_count=sc or 4,
                language_hints=hints,
            )

        body = wrap_dashscope_response(sentences)
        body["duration_ms"] = int(round(dur * 1000))  # noqa: RUF046
        body["adapter_mode"] = mode if sentences else "stub"
        return JSONResponse(body)
    finally:
        tmp_path.unlink(missing_ok=True)
