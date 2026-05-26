"""
Live meeting ASR — streaming bridge (primary) and segment-batch fallback.

Product tiers (``asr.live.*`` / ``asr.*``):

1. **Primary — duplex WS streaming** (``asr.live``): driver from ``stream_protocol`` + WS URL
   (``dashscope``, ``funasr_nano_ws``, ``funasr_runtime``, …) — not tied to batch provider.
2. **Fallback — closed PCM segments** (~5 s): batch ``asr.*`` slot via ``transcribe_audio_auto``
   (``openai_compat`` multipart or ``json_transcribe`` POST /transcribe).
3. **Last resort — retry** ``asr_fallback`` when primary segment path errors.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from oaao_orchestrator.asr_common import has_batch_transcribe_config, transcribe_audio_auto
from oaao_orchestrator.live_meeting.audio_store import BYTES_PER_SAMPLE, SAMPLE_RATE

logger = logging.getLogger(__name__)


def is_streaming_asr_mode(asr_cfg: dict[str, Any] | None) -> bool:
    if not asr_cfg or not isinstance(asr_cfg, dict):
        return False
    mode = str(asr_cfg.get("mode") or asr_cfg.get("asr_mode") or "").strip().lower()
    return mode in ("streaming", "stream", "realtime")


def use_remote_pcm_stream_bridge(asr_cfg: dict[str, Any] | None) -> bool:
    """True when payload includes a duplex WS URL for live streaming (any provider)."""
    if not is_streaming_asr_mode(asr_cfg) or not isinstance(asr_cfg, dict):
        return False
    stream_protocol = (
        str(asr_cfg.get("stream_protocol") or asr_cfg.get("live_stream_protocol") or "")
        .strip()
        .lower()
    )
    if stream_protocol == "dashscope":
        return False
    return bool(resolve_live_stream_ws_url(asr_cfg))


def _coerce_live_stream_ws_url(raw: str) -> str:
    """ASR-Live payloads: http(s) base_url → ws(s) stream URL."""
    u = raw.strip()
    if not u:
        return ""
    lower = u.lower()
    if lower.startswith(("ws://", "wss://")):
        return u.rstrip("/")
    if not lower.startswith(("http://", "https://")):
        return ""
    parsed = urlparse(u)
    host = parsed.hostname or ""
    if not host:
        return ""
    ws_scheme = "ws" if lower.startswith("http://") else "wss"
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path.rstrip("/")
    return f"{ws_scheme}://{host}{port}{path}"


def resolve_live_stream_ws_url(asr_cfg: dict[str, Any] | None) -> str:
    if not isinstance(asr_cfg, dict):
        return ""
    for key in ("funasr_stream_url", "ws_url", "dashscope_ws_url", "base_url"):
        stream_url = str(asr_cfg.get(key) or "").strip()
        if stream_url.lower().startswith(("ws://", "wss://")):
            return stream_url
        coerced = _coerce_live_stream_ws_url(stream_url)
        if coerced:
            return coerced
    return ""


def use_funasr_nano_stream_bridge(asr_cfg: dict[str, Any] | None) -> bool:
    """Alias — prefer ``use_remote_pcm_stream_bridge``."""
    return use_remote_pcm_stream_bridge(asr_cfg)


def has_http_transcribe_base(asr_cfg: dict[str, Any] | None) -> bool:
    """Backward-compatible alias — prefer ``has_batch_transcribe_config``."""
    return has_batch_transcribe_config(asr_cfg)


def segment_transcribe_asr_cfg(
    primary: dict[str, Any] | None,
    fallback: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Live ~5 s segments use the batch ``asr.*`` slot when configured (not live stream cfg)."""
    if isinstance(fallback, dict) and fallback and has_batch_transcribe_config(fallback):
        return fallback
    if isinstance(primary, dict) and primary and has_batch_transcribe_config(primary):
        return primary
    return fallback if isinstance(fallback, dict) else primary


def use_live_streaming_bridge(asr_cfg: dict[str, Any] | None) -> bool:
    """True when live partial/final should come from a WS bridge (segment batch skipped)."""
    return use_dashscope_realtime_stream(asr_cfg) or use_remote_pcm_stream_bridge(asr_cfg)


def use_dashscope_realtime_stream(asr_cfg: dict[str, Any] | None) -> bool:
    """True when Alibaba DashScope duplex WS should handle live transcription."""
    if not is_streaming_asr_mode(asr_cfg) or not isinstance(asr_cfg, dict):
        return False
    provider = str(asr_cfg.get("provider") or "").strip().lower()
    if provider in ("funasr_nano", "funasr-nano", "funasr_nano_remote", "funasr_local_stream"):
        return False
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
