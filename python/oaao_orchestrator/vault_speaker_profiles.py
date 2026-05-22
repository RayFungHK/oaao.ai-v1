"""Vault speaker voiceprint matching — orchestrator → PHP internal API."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.speaker_embedding import extract_speaker_embeddings

logger = logging.getLogger(__name__)


def _vault_api_base() -> str:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    return base


def _internal_headers() -> dict[str, str]:
    secret = os.environ.get("OAAO_ORCH_SHARED_SECRET", "oaao_dev_shared_secret").strip()
    return {
        "X-OAAO-Internal-Token": secret,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
    }


async def apply_voiceprint_matching(
    client: httpx.AsyncClient,
    *,
    job: dict[str, Any],
    audio_path: str,
    asr_meta: dict[str, Any],
) -> dict[str, Any] | None:
    """
    Extract speaker embeddings, call PHP match API, return updated asr fragment + source_text.

    Returns None when matching is skipped or unavailable.
    """
    base = _vault_api_base()
    if not base:
        logger.debug("voiceprint: OAAO_VAULT_JOB_POLL_BASE_URL unset — skip match")
        return None

    segments = asr_meta.get("segments")
    if not isinstance(segments, list) or not segments:
        return None

    # Pseudo diarization rotates speaker_id by sentence index — not real speakers.
    # Voiceprint match would collapse Speaker 1–4 to one vault profile (same voice).
    if asr_meta.get("pseudo_diarization"):
        logger.info(
            "voiceprint: skip auto-match — pseudo diarization doc=%s",
            job.get("payload", {}).get("document_id") if isinstance(job.get("payload"), dict) else None,
        )
        return None

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    doc_id = payload.get("document_id")
    vault_id = job.get("vault_id")
    try:
        doc_id_i = int(doc_id) if doc_id is not None else 0
        vault_id_i = int(vault_id) if vault_id is not None else 0
    except (TypeError, ValueError):
        return None
    if doc_id_i < 1 or vault_id_i < 1:
        return None

    speaker_rows = await extract_speaker_embeddings(audio_path, segments)
    if not speaker_rows:
        logger.info("voiceprint: no embeddings extracted doc=%s", doc_id_i)
        return None

    body: dict[str, Any] = {
        "document_id": doc_id_i,
        "vault_id": vault_id_i,
        "speakers": speaker_rows,
        "pseudo_diarization": bool(asr_meta.get("pseudo_diarization")),
        "asr": dict(asr_meta),
    }

    url = f"{base}/vault_speaker_match"
    try:
        r = await client.post(url, headers=_internal_headers(), json=body, timeout=60.0)
    except httpx.RequestError as e:
        logger.warning("voiceprint: match request failed doc=%s: %s", doc_id_i, e)
        return None

    if r.status_code >= 400:
        logger.warning("voiceprint: match HTTP %s doc=%s — %s", r.status_code, doc_id_i, r.text[:300])
        return None

    try:
        envelope = r.json()
    except json.JSONDecodeError:
        logger.warning("voiceprint: match invalid JSON doc=%s", doc_id_i)
        return None

    if not isinstance(envelope, dict) or envelope.get("success") is not True:
        return None

    data = envelope.get("data")
    if not isinstance(data, dict):
        return None

    asr_out = data.get("asr")
    if not isinstance(asr_out, dict):
        return None

    matches = data.get("matches")
    match_count = len(matches) if isinstance(matches, list) else 0
    if match_count:
        logger.info(
            "voiceprint: auto-matched %s speaker(s) doc=%s vault=%s",
            match_count,
            doc_id_i,
            vault_id_i,
        )

    result: dict[str, Any] = {"asr": asr_out}
    source_text = data.get("source_text")
    if isinstance(source_text, str) and source_text.strip():
        result["source_text"] = source_text.strip()

    return result
