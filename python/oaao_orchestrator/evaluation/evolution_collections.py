"""Ensure Arango collections for evolution metrics persistence."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.evaluation.evolution_store import _arango_cfg
from oaao_orchestrator.vault_arango import _arango_request

logger = logging.getLogger(__name__)

EVOLUTION_COLLECTIONS = (
    "evolution_runs",
    "low_score_cases",
    "evolution_patches",
    "evolution_reports",
)


async def ensure_evolution_collections() -> dict[str, Any]:
    """Create document collections when Arango is configured (idempotent)."""
    cfg = await _arango_cfg()
    if not cfg:
        return {"ok": False, "reason": "arango_not_configured", "collections": list(EVOLUTION_COLLECTIONS)}
    created: list[str] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        for name in EVOLUTION_COLLECTIONS:
            r_col = await _arango_request(
                client,
                cfg=cfg,
                method="POST",
                path="/_api/collection",
                json_body={"name": name, "type": 2},
            )
            if r_col is not None and r_col.status_code in (200, 201):
                created.append(name)
            elif r_col is not None and r_col.status_code == 409:
                continue
            elif r_col is not None:
                logger.warning(
                    "evolution_collections: create %s HTTP %s — %s",
                    name,
                    r_col.status_code,
                    (r_col.text or "")[:200],
                )
    return {"ok": True, "collections": list(EVOLUTION_COLLECTIONS), "created": created}
