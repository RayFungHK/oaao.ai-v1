"""
Live meeting ASR — segment batch (openai_compat / funasr) and optional streaming mode.

When Purpose ``meta_json.mode`` is ``streaming``, upstream Qwen WebSocket wiring is deferred;
closed PCM segments are still transcribed via {@see transcribe_audio_auto} until WS spec is fixed.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.asr_common import transcribe_audio_auto
from oaao_orchestrator.live_meeting.audio_store import BYTES_PER_SAMPLE, SAMPLE_RATE

logger = logging.getLogger(__name__)


def is_streaming_asr_mode(asr_cfg: dict[str, Any] | None) -> bool:
    if not asr_cfg or not isinstance(asr_cfg, dict):
        return False
    mode = str(asr_cfg.get("mode") or asr_cfg.get("asr_mode") or "").strip().lower()
    return mode in ("streaming", "stream", "realtime")


def use_dashscope_realtime_stream(asr_cfg: dict[str, Any] | None) -> bool:
    """True when Alibaba DashScope duplex WS should handle live transcription."""
    if not is_streaming_asr_mode(asr_cfg) or not isinstance(asr_cfg, dict):
        return False
    provider = str(asr_cfg.get("provider") or "").strip().lower()
    if provider in ("dashscope", "dashscope_funasr", "dashscope_qwen", "qwen", "funasr_realtime"):
        return True
    if str(asr_cfg.get("dashscope_ws_url") or asr_cfg.get("ws_url") or "").strip():
        return True
    model = str(asr_cfg.get("model") or "").strip().lower()
    return "realtime" in model or model.startswith("fun-asr") or model.startswith("qwen3-asr")


async def pcm_segment_to_wav(pcm_path: Path) -> str | None:
    """Convert mono s16le 16 kHz PCM to a temporary WAV for ASR providers."""
    if not pcm_path.is_file() or pcm_path.stat().st_size < BYTES_PER_SAMPLE * 10:
        return None
    out = Path(tempfile.mkstemp(prefix="oaao_live_seg_", suffix=".wav")[1])
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "s16le",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        "1",
        "-i",
        str(pcm_path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        str(out),
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "live_meeting pcm_to_wav failed rc=%s path=%s err=%s",
                proc.returncode,
                pcm_path,
                (err or b"")[:200].decode(errors="replace"),
            )
            out.unlink(missing_ok=True)
            return None
        if not out.is_file() or out.stat().st_size < 44:
            out.unlink(missing_ok=True)
            return None
        return str(out)
    except FileNotFoundError:
        logger.warning("ffmpeg not found — live segment ASR unavailable")
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("live_meeting pcm_to_wav error: %s", e)
        out.unlink(missing_ok=True)
        return None


async def transcribe_live_pcm_segment(
    *,
    pcm_path: Path,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """Transcribe one closed ``seg_*.pcm`` file. Returns (text, error)."""
    wav_path = await pcm_segment_to_wav(pcm_path)
    if not wav_path:
        return None, "segment_too_short_or_ffmpeg_failed"
    try:
        async with httpx.AsyncClient() as client:
            text, err, _extra = await transcribe_audio_auto(
                client,
                audio_path=wav_path,
                asr_cfg=asr_cfg,
                glossary=glossary,
            )
        if err:
            return None, err
        if text and text.strip():
            return text.strip(), None
        return None, "asr_empty_transcript"
    finally:
        Path(wav_path).unlink(missing_ok=True)
