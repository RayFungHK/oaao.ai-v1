"""Seal high-ACCS runs into reusable crystallized skills (Evolution §8)."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from oaao_orchestrator.crystallization.embedding import embed_intent, skill_id_for_run
from oaao_orchestrator.crystallization.models import CrystallizedSkill
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

MIN_ACCS = 0.85
MIN_TOOL_CHAIN_LEN = 2
COLLECTION = "crystallized_skills"

_MEMORY: dict[str, CrystallizedSkill] = {}
_MEMORY_VECTORS: dict[str, list[float]] = {}


def _trigger_intent(user_message: str) -> str:
    text = (user_message or "").strip().replace("\n", " ")
    return text[:80] if text else "general task"


def _flags_block_seal(flags: dict[str, Any] | None) -> bool:
    if not isinstance(flags, dict):
        return False
    for key in ("degraded", "iqs_skipped", "accs_skipped"):
        if bool(flags.get(key)):
            return True
    return False


def _register_in_memory(skill: CrystallizedSkill) -> None:
    _MEMORY[skill.id] = skill
    if skill.intent_embedding:
        _MEMORY_VECTORS[skill.id] = list(skill.intent_embedding)


async def _qdrant_upsert_skill(skill: CrystallizedSkill) -> None:
    base = os.environ.get("OAAO_QDRANT_URL", "").strip().rstrip("/")
    if not base or not skill.intent_embedding:
        return
    url = f"{ensure_url_scheme(base)}/collections/{COLLECTION}/points"
    point_id = skill.id
    body = {
        "points": [
            {
                "id": point_id,
                "vector": skill.intent_embedding,
                "payload": {
                    "id": skill.id,
                    "tool_chain": skill.tool_chain,
                    "usage_count": skill.usage_count,
                    "trigger_intent": skill.trigger_intent,
                },
            }
        ]
    }
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("OAAO_QDRANT_API_KEY", "").strip()
    if key:
        headers["api-key"] = key
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        await client.put(url, headers=headers, json=body)


async def _arango_insert_skill(skill: CrystallizedSkill) -> None:
    from oaao_orchestrator.vault_arango import _arango_request, resolve_arango_from_profile  # noqa: PLC0415

    cfg = resolve_arango_from_profile({})
    if not cfg:
        return
    doc = skill.model_dump(mode="json")
    doc["_key"] = skill.id
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        await _arango_request(
            client,
            cfg=cfg,
            method="POST",
            path=f"/_api/document/{COLLECTION}",
            json_body=doc,
        )


async def try_seal_skill(
    *,
    run_id: str,
    accs_score: float,
    tool_chain: list[str],
    planner_output: dict[str, Any],
    final_answer: str,
    user_message: str,
    flags: dict[str, Any] | None = None,
    embedding_cfg: dict[str, Any] | None = None,
) -> CrystallizedSkill | None:
    """
    Persist a crystallized skill when ACCS and tool-chain criteria are met.

    Writes to in-memory index always; Qdrant + Arango when configured.
    """
    chain = [str(x).strip() for x in tool_chain if str(x).strip()]
    if accs_score < MIN_ACCS or len(chain) < MIN_TOOL_CHAIN_LEN:
        return None
    if _flags_block_seal(flags):
        return None

    skill_id = skill_id_for_run(planner_output=planner_output, final_answer=final_answer)
    intent_vec = await embed_intent(user_message, embedding_cfg)
    skill = CrystallizedSkill(
        id=skill_id,
        trigger_intent=_trigger_intent(user_message),
        intent_embedding=intent_vec,
        tool_chain=chain,
        param_template={},
        success_score=float(accs_score),
        usage_count=0,
        created_at=datetime.now(timezone.utc),
        last_used_at=None,
        source_run_id=str(run_id or ""),
    )

    _register_in_memory(skill)
    try:
        await _qdrant_upsert_skill(skill)
    except Exception:
        logger.warning("qdrant upsert skill failed id=%s", skill.id, exc_info=True)
    try:
        await _arango_insert_skill(skill)
    except Exception:
        logger.warning("arango insert skill failed id=%s", skill.id, exc_info=True)

    logger.info(
        "crystallized skill sealed id=%s accs=%.3f chain=%s",
        skill.id,
        accs_score,
        json.dumps(chain),
    )
    return skill


def memory_skills_for_tests() -> dict[str, CrystallizedSkill]:
    """Expose in-memory store for integration tests."""
    return dict(_MEMORY)
