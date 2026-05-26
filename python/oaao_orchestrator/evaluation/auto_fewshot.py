"""Write auto-generated few-shot examples to Qdrant (Evolution §7.3)."""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.crystallization.collections import AUTO_FEWSHOT_COLLECTION
from oaao_orchestrator.crystallization.embedding import embed_intent
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


async def write_auto_fewshot(
    *,
    bad_input: str,
    corrected_input: str,
    report_id: str,
    embedding_cfg: dict[str, Any] | None = None,
) -> bool:
    """Upsert a counter-example pair into Qdrant ``auto_fewshot`` collection."""
    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if not base:
        return False
    text = f"bad: {bad_input.strip()}\ncorrected: {corrected_input.strip()}"
    vec = await embed_intent(text, embedding_cfg)
    if not vec:
        return False
    point_id = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
    url = f"{ensure_url_scheme(base)}/collections/{AUTO_FEWSHOT_COLLECTION}/points"
    body = {
        "points": [
            {
                "id": point_id,
                "vector": vec,
                "payload": {
                    "bad_input": bad_input.strip()[:500],
                    "corrected_input": corrected_input.strip()[:500],
                    "auto_generated": True,
                    "report_id": report_id,
                },
            }
        ]
    }
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
    if key:
        headers["api-key"] = key
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            resp = await client.put(url, headers=headers, json=body)
            return resp.status_code < 400
    except Exception:  # noqa: BLE001
        logger.warning("auto_fewshot qdrant upsert failed", exc_info=True)
        return False
