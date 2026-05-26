"""Hydrate in-memory crystallized skill index from Qdrant on startup."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.crystallization.models import CrystallizedSkill
from oaao_orchestrator.crystallization.sealer import (
    _MEMORY,
    COLLECTION,
    _register_in_memory,
)
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


async def bootstrap_crystallized_skills(*, limit: int = 200) -> dict[str, Any]:
    """Load recent skill points from Qdrant + Arango into process memory (cold-start recall)."""
    loaded = 0
    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if base:
        url = f"{ensure_url_scheme(base)}/collections/{COLLECTION}/points/scroll"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
        if key:
            headers["api-key"] = key
        body = {"limit": max(1, min(limit, 500)), "with_payload": True, "with_vector": True}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
                resp = await client.post(url, headers=headers, json=body)
                if resp.status_code < 400:
                    data = resp.json()
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
                            param_template=payload.get("param_template")
                            if isinstance(payload.get("param_template"), dict)
                            else {},
                        )
                        _register_in_memory(skill)
                        loaded += 1
        except Exception:  # noqa: BLE001
            logger.debug("crystallization qdrant bootstrap failed", exc_info=True)

    arango_loaded = await _bootstrap_from_arango(limit=limit)
    if loaded == 0 and arango_loaded == 0:
        return {"ok": False, "reason": "stores_empty_or_unconfigured", "loaded": 0}
    return {
        "ok": True,
        "loaded": loaded,
        "arango_loaded": arango_loaded,
        "memory_count": len(_MEMORY),
    }


async def _bootstrap_from_arango(*, limit: int = 200) -> int:
    from oaao_orchestrator.vault_arango import _arango_request, resolve_arango_from_profile

    cfg = resolve_arango_from_profile({})
    if not cfg:
        return 0
    loaded = 0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            resp = await _arango_request(
                client,
                cfg=cfg,
                method="POST",
                path="/_api/cursor",
                json_body={
                    "query": f"FOR s IN {COLLECTION} SORT s.created_at DESC LIMIT @lim RETURN s",
                    "bindVars": {"lim": max(1, min(limit, 500))},
                },
            )
            if resp is None or resp.status_code != 201:
                return 0
            for row in resp.json().get("result") or []:
                if not isinstance(row, dict):
                    continue
                sid = str(row.get("_key") or row.get("id") or "").strip()
                if not sid or sid in _MEMORY:
                    continue
                chain_raw = row.get("tool_chain")
                chain = [str(x) for x in chain_raw] if isinstance(chain_raw, list) else []
                skill = CrystallizedSkill(
                    id=sid,
                    trigger_intent=str(row.get("trigger_intent") or sid),
                    intent_embedding=list(row.get("intent_embedding") or []),
                    tool_chain=chain,
                    param_template=row.get("param_template")
                    if isinstance(row.get("param_template"), dict)
                    else {},
                    success_score=float(row.get("success_score") or 0.0),
                    usage_count=int(row.get("usage_count") or 0),
                )
                _register_in_memory(skill)
                loaded += 1
    except Exception:  # noqa: BLE001
        logger.debug("crystallization arango bootstrap failed", exc_info=True)
        return loaded
    return loaded


def crystallization_stats() -> dict[str, Any]:
    """In-process crystallization counters for admin UI."""
    skills = list(_MEMORY.values())
    return {
        "skill_count": len(skills),
        "total_usage": sum(int(s.usage_count or 0) for s in skills),
        "sample_chains": [list(s.tool_chain)[:6] for s in skills[:5]],
    }
