"""Vault hook vh.rag.audio_asr — ffmpeg → ASR → glossary → polish → source_text for embed chain."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from oaao_orchestrator.asr_common import run_asr_pipeline_on_file

logger = logging.getLogger(__name__)


def _build_asr_meta_json(meta: dict[str, Any]) -> dict[str, Any]:
    """Normalize orchestrator ASR meta for vault_job_finish → document meta_json."""
    out: dict[str, Any] = {
        "raw_text": meta.get("raw_text", ""),
        "polished": bool(meta.get("polished")),
        "chunked": bool(meta.get("chunked")),
        "chunk_count": meta.get("chunk_count", 0),
        "chunk_buffer_before_sec": meta.get("chunk_buffer_before_sec"),
        "chunk_buffer_after_sec": meta.get("chunk_buffer_after_sec"),
    }
    if meta.get("mode") == "speaker":
        out["mode"] = "speaker"
        out["provider"] = str(meta.get("provider") or "funasr")
        out["chunked"] = False
        out["chunk_count"] = 0
        if meta.get("duration_sec") is not None:
            out["duration_sec"] = meta.get("duration_sec")
        if meta.get("speaker_count") is not None:
            out["speaker_count"] = meta.get("speaker_count")
        if meta.get("pseudo_diarization"):
            out["pseudo_diarization"] = True
        if meta.get("speaker_profiles_matched") is not None:
            out["speaker_profiles_matched"] = meta.get("speaker_profiles_matched")
        if isinstance(meta.get("segments"), list):
            out["segments"] = meta.get("segments")
        if isinstance(meta.get("speakers"), list):
            out["speakers"] = meta.get("speakers")
    else:
        out["mode"] = "normal"
    return out


async def process_vault_audio_asr(client: httpx.AsyncClient, job: dict[str, Any]) -> tuple[str, str | None, dict[str, Any]]:
    """
    Process one audio ASR job.

    Returns (status, error_message_or_none, finish_extras) where finish_extras may include
    source_text and meta_json for PHP vault_job_finish.
    """
    hook = str(job.get("hook_id") or "")
    if hook != "vh.rag.audio_asr":
        return "failed", f"unsupported_hook:{hook}", {}

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    abs_path = str(job.get("absolute_path") or "").strip()
    if abs_path == "" and isinstance(payload, dict):
        sr = str(payload.get("storage_root") or "").rstrip("/")
        rp = str(payload.get("relative_path") or "").lstrip("/")
        if sr and rp:
            abs_path = f"{sr}/{rp}"
    if abs_path == "":
        return "failed", "missing_absolute_path", {}

    asr_cfg = payload.get("asr") if isinstance(payload.get("asr"), dict) else None
    polish_cfg = payload.get("polish") if isinstance(payload.get("polish"), dict) else None
    glossary = payload.get("glossary") if isinstance(payload.get("glossary"), dict) else None
    polish_on = payload.get("polish_enabled")
    polish_enabled = True if polish_on is None else bool(polish_on)

    text, meta = await run_asr_pipeline_on_file(
        client,
        audio_path=abs_path,
        asr_cfg=asr_cfg,
        polish_cfg=polish_cfg,
        glossary=glossary,
        polish_enabled=polish_enabled,
    )
    if not text:
        err = str(meta.get("error") or "asr_failed")
        return "failed", err[:4000], {}

    asr_meta = _build_asr_meta_json(meta)

    if meta.get("mode") == "speaker":
        from oaao_orchestrator.vault_speaker_profiles import apply_voiceprint_matching

        matched = await apply_voiceprint_matching(
            client,
            job=job,
            audio_path=abs_path,
            asr_meta=asr_meta,
        )
        if matched:
            if isinstance(matched.get("asr"), dict):
                asr_meta = matched["asr"]
            if isinstance(matched.get("source_text"), str) and matched["source_text"].strip():
                text = matched["source_text"].strip()

    finish_extras: dict[str, Any] = {
        "source_text": text[:500000],
        "usage": {"char_count": len(text)},
        "meta_json": {
            "asr": asr_meta,
        },
        "enqueue_document_embed": True,
    }

    logger.info(
        "vault_audio_asr: job=%s doc=%s chars=%s polished=%s",
        job.get("job_id"),
        payload.get("document_id"),
        len(text),
        meta.get("polished"),
    )
    return "completed", None, finish_extras
