"""Ensure Arango / Qdrant collections for crystallized skills."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.vault_arango import _arango_request, resolve_arango_from_profile
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

COLLECTION = "crystallized_skills"
QDRANT_COLLECTION = "crystallized_skills"
AUTO_FEWSHOT_COLLECTION = "auto_fewshot"


async def ensure_crystallized_collections() -> dict[str, Any]:
    """Create crystallized_skills in Arango and Qdrant when configured."""
    out: dict[str, Any] = {"arango": False, "qdrant": False, "auto_fewshot": False}
    cfg = resolve_arango_from_profile({})
    if cfg:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
                r_col = await _arango_request(
                    client,
                    cfg=cfg,
                    method="POST",
                    path="/_api/collection",
                    json_body={"name": COLLECTION, "type": 2},
                )
                if r_col is not None and r_col.status_code in (200, 201, 409):
                    out["arango"] = True
        except Exception:  # noqa: BLE001
            logger.debug("ensure crystallized_skills arango failed", exc_info=True)

    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if base:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
        if key:
            headers["api-key"] = key
        url_base = ensure_url_scheme(base)
        for qname in (QDRANT_COLLECTION, AUTO_FEWSHOT_COLLECTION):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
                    resp = await client.put(
                        f"{url_base}/collections/{qname}",
                        headers=headers,
                        json={"vectors": {"size": 1024, "distance": "Cosine"}},
                    )
                    if resp.status_code in (200, 201, 409):
                        out["qdrant" if qname == QDRANT_COLLECTION else "auto_fewshot"] = True
            except Exception:  # noqa: BLE001
                logger.debug("ensure qdrant %s failed", qname, exc_info=True)
    return out
