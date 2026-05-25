"""TTS provider stub — Phase 10+ (Supertonic / external API)."""

from __future__ import annotations

import os
from typing import Any


def tts_enabled() -> bool:
    return bool((os.environ.get("OAAO_TTS_BASE_URL") or "").strip())


async def synthesize_speech(text: str, *, voice: str | None = None) -> dict[str, Any]:
    """
    Return ``{audio_url, mime, stub}`` — real provider wired via ``OAAO_TTS_BASE_URL``.
    """
    if not tts_enabled():
        return {"stub": True, "message": "Set OAAO_TTS_BASE_URL to enable TTS."}
    base = os.environ.get("OAAO_TTS_BASE_URL", "").strip().rstrip("/")
    return {
        "stub": False,
        "audio_url": f"{base}/v1/speech",
        "mime": "audio/mpeg",
        "voice": voice or "default",
        "text_len": len(text or ""),
    }
