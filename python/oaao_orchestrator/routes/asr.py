"""W5-S1 phase 6 — ASR + FunASR endpoints.

Extracted verbatim from ``app.py`` (transcribe + funasr ensure/status). All
three handlers are internal-token-gated; the guard now lives at the router
level via ``require_internal_token`` instead of three inline
``secrets.compare_digest`` blocks.

- ``POST /v1/asr/transcribe`` — base64 audio → text (whisper or FunASR).
- ``POST /v1/funasr/ensure``  — bring up the FunASR docker companion.
- ``GET  /v1/funasr/status``  — current FunASR container status.

The ``AsrTranscribeRequest`` / ``FunasrEnsureRequest`` Pydantic models move
with the routes; only consumers are the handlers below.
"""

from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from oaao_orchestrator.asr_common import run_asr_pipeline_on_file
from oaao_orchestrator.funasr_ops import ensure_funasr, funasr_status
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(
    tags=["asr"],
    dependencies=[Depends(require_internal_token)],
)


class AsrTranscribeRequest(BaseModel):
    workspace_id: int | None = None
    audio_base64: str = ""
    mime_type: str = "audio/webm"
    polish_enabled: bool = True
    glossary: dict[str, Any] | None = None
    asr: dict[str, Any] | None = None
    polish: dict[str, Any] | None = None


class FunasrEnsureRequest(BaseModel):
    pull: bool = True
    funasr_env: dict[str, str] | None = None
    recreate: bool = False


@router.post("/v1/asr/transcribe")
async def transcribe_audio(req: AsrTranscribeRequest) -> dict[str, Any]:
    raw_b64 = (req.audio_base64 or "").strip()
    if raw_b64.startswith("data:") and "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]
    if not raw_b64:
        raise HTTPException(status_code=400, detail="audio_base64 required")

    try:
        audio_bytes = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_base64") from exc

    suffix = ".webm" if "webm" in req.mime_type.lower() else ".wav"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="oaao_chat_asr_")
    os.close(fd)
    try:
        Path(tmp_path).write_bytes(audio_bytes)
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            text, meta = await run_asr_pipeline_on_file(
                client,
                audio_path=tmp_path,
                asr_cfg=req.asr if isinstance(req.asr, dict) else None,
                polish_cfg=req.polish if isinstance(req.polish, dict) else None,
                glossary=req.glossary if isinstance(req.glossary, dict) else None,
                polish_enabled=bool(req.polish_enabled),
            )
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not text:
        raise HTTPException(
            status_code=502, detail=str(meta.get("error") or "transcription_failed")
        )

    return {
        "text": text,
        "raw_text": meta.get("raw_text", ""),
        "polished": bool(meta.get("polished")),
    }


@router.post("/v1/funasr/ensure")
async def funasr_ensure(req: FunasrEnsureRequest) -> dict[str, Any]:
    return await ensure_funasr(
        pull=bool(req.pull), funasr_env=req.funasr_env, recreate=bool(req.recreate)
    )


@router.get("/v1/funasr/status")
async def funasr_status_route() -> dict[str, Any]:
    return await funasr_status()
