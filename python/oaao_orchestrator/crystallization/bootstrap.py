"""Hydrate in-memory crystallized skill index from Qdrant on startup."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.crystallization.models import CrystallizedSkill
from oaao_orchestrator.crystallization.sealer import COLLECTION, _MEMORY, _MEMORY_VECTORS, _register_in_memory
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


async def bootstrap_crystallized_skills(*, limit: int = 200) -> dict[str, Any]:
    """Load recent skill points from Qdrant into process memory (cold-start recall)."""
    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if not base:
        return {"ok": False, "reason": "qdrant_not_configured", "loaded": 0}
    url = f"{ensure_url_scheme(base)}/collections/{COLLECTION}/points/scroll"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
    if key:
        headers["api-key"] = key
    body = {"limit": max(1, min(limit, 500)), "with_payload": True, "with_vector": True}
    loaded = 0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code >= 400:
                return {"ok": False, "reason": f"qdrant_http_{resp.status_code}", "loaded": 0}
            data = resp.json()
    except Exception:
        logger.debug("crystallization bootstrap failed", exc_info=True)
        return {"ok": False, "reason": "qdrant_scroll_failed", "loaded": 0}

    for row in data.get("result", {}).get("points") or []:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        sid = str(payload.get("id") or row.get("id") or "").strip()
        if not sid:
            continue
        chain_raw = payload.get("tool_chain")
        chain = [str(x) for x in chain_raw] if isinstance(chain_raw, list) else []
        vec = row.get("vector")
        embedding = list(vec) if isinstance(vec, list) else []
        skill = CrystallizedSkill(
            id=sid,
            trigger_intent=str(payload.get("trigger_intent") or sid),
            intent_embedding=embedding,
            tool_chain=chain,
            success_score=float(payload.get("success_score") or 0.0),
            usage_count=int(payload.get("usage_count") or 0),
        )
        _register_in_memory(skill)
        loaded += 1
    return {"ok": True, "loaded": loaded, "memory_count": len(_MEMORY)}


def crystallization_stats() -> dict[str, Any]:
    """In-process crystallization counters for admin UI."""
    skills = list(_MEMORY.values())
    return {
        "skill_count": len(skills),
        "total_usage": sum(int(s.usage_count or 0) for s in skills),
        "sample_chains": [list(s.tool_chain)[:6] for s in skills[:5]],
    }
