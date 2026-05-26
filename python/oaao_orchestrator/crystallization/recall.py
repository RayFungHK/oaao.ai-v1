"""Recall crystallized skills at IQS stage (Evolution §8.4)."""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx

from oaao_orchestrator.crystallization.embedding import cosine_similarity, embed_intent
from oaao_orchestrator.crystallization.models import CrystallizedSkill, RecallHit
from oaao_orchestrator.crystallization.sealer import _MEMORY, _MEMORY_VECTORS, COLLECTION
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

SIM_THRESHOLD = 0.88


async def _bump_usage_count(skill_id: str) -> None:
    skill = _MEMORY.get(skill_id)
    if skill is not None:
        skill.usage_count += 1
        skill.last_used_at = datetime.now(UTC)
        _MEMORY[skill_id] = skill


async def _qdrant_search(
    query_vec: list[float], *, limit: int = 1
) -> list[tuple[float, str, dict[str, Any]]]:
    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if not base or not query_vec:
        return []
    url = f"{ensure_url_scheme(base)}/collections/{COLLECTION}/points/search"
    body = {"vector": query_vec, "limit": limit, "with_payload": True}
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
    if key:
        headers["api-key"] = key
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code >= 400:
                return []
            data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("qdrant skill search failed", exc_info=True)
        return []

    out: list[tuple[float, str, dict[str, Any]]] = []
    for row in data.get("result") or []:
        if not isinstance(row, dict):
            continue
        score = float(row.get("score") or 0.0)
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        sid = str(payload.get("id") or row.get("id") or "").strip()
        if sid:
            out.append((score, sid, payload))
    return out


def _memory_search(query_vec: list[float]) -> tuple[CrystallizedSkill | None, float]:
    best: CrystallizedSkill | None = None
    best_sim = 0.0
    for sid, vec in _MEMORY_VECTORS.items():
        sim = cosine_similarity(query_vec, vec)
        if sim > best_sim:
            skill = _MEMORY.get(sid)
            if skill is not None:
                best = skill
                best_sim = sim
    return best, best_sim


async def recall_skill(
    user_message: str,
    *,
    embedding_cfg: dict[str, Any] | None = None,
) -> RecallHit | None:
    """Find top crystallized skill at cosine sim >= 0.88."""
    query_vec = await embed_intent(user_message, embedding_cfg)

    skill, sim = _memory_search(query_vec)
    if skill is not None and sim >= SIM_THRESHOLD:
        await _bump_usage_count(skill.id)
        return RecallHit(skill=skill, similarity=sim)

    for qsim, sid, payload in await _qdrant_search(query_vec):
        if qsim < SIM_THRESHOLD:
            continue
        hit = _MEMORY.get(sid)
        if hit is None:
            chain_raw = payload.get("tool_chain") if isinstance(payload, dict) else None
            chain = [str(x) for x in chain_raw] if isinstance(chain_raw, list) else []
            hit = CrystallizedSkill(
                id=sid,
                trigger_intent=str(payload.get("trigger_intent") or (user_message or "")[:80]),
                intent_embedding=query_vec,
                tool_chain=chain,
                success_score=float(payload.get("success_score") or 0.0)
                if isinstance(payload, dict)
                else 0.0,
            )
            _MEMORY[sid] = hit
        await _bump_usage_count(sid)
        return RecallHit(skill=hit, similarity=qsim)

    return None
