"""LRU eviction for crystallized skills (Evolution §8.5)."""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from oaao_orchestrator.crystallization.collections import COLLECTION
from oaao_orchestrator.crystallization.sealer import _MEMORY
from oaao_orchestrator.vault_arango import _arango_request, resolve_arango_from_profile

logger = logging.getLogger(__name__)

MAX_SKILLS = int(os.environ.get("OAAO_CRYSTALLIZED_SKILLS_MAX", "500") or "500")
STALE_DAYS = int(os.environ.get("OAAO_CRYSTALLIZED_SKILLS_STALE_DAYS", "90") or "90")
LOW_SCORE = float(os.environ.get("OAAO_CRYSTALLIZED_SKILLS_LOW_SCORE", "0.70") or "0.70")


def _is_stale(skill: dict[str, Any], *, cutoff: datetime) -> bool:
    usage = int(skill.get("usage_count") or 0)
    score = float(skill.get("success_score") or 0.0)
    if score < LOW_SCORE:
        return True
    if usage > 0:
        return False
    created_raw = skill.get("created_at")
    if not created_raw:
        return False
    try:
        created = datetime.fromisoformat(str(created_raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    return created < cutoff


async def evict_stale_crystallized_skills(*, dry_run: bool = False) -> dict[str, Any]:
    """Remove unused stale skills and trim overflow beyond MAX_SKILLS."""
    cfg = resolve_arango_from_profile({})
    cutoff = datetime.now(UTC) - timedelta(days=max(1, STALE_DAYS))
    evicted: list[str] = []
    candidates: list[tuple[str, int, float, datetime]] = []

    for sid, skill in _MEMORY.items():
        doc = skill.model_dump(mode="json")
        candidates.append(
            (
                sid,
                int(skill.usage_count or 0),
                float(skill.success_score or 0.0),
                skill.created_at if skill.created_at else datetime.now(UTC),
            )
        )
        if _is_stale(doc, cutoff=cutoff):
            evicted.append(sid)

    if cfg:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            resp = await _arango_request(
                client,
                cfg=cfg,
                method="POST",
                path="/_api/cursor",
                json_body={"query": f"FOR s IN {COLLECTION} RETURN s"},
            )
            if resp is not None and resp.status_code == 201:
                for row in resp.json().get("result") or []:
                    if not isinstance(row, dict):
                        continue
                    sid = str(row.get("_key") or row.get("id") or "").strip()
                    if not sid:
                        continue
                    if sid not in {c[0] for c in candidates}:
                        created_raw = row.get("created_at")
                        try:
                            created = datetime.fromisoformat(str(created_raw).replace("Z", "+00:00"))
                        except ValueError:
                            created = datetime.now(UTC)
                        candidates.append(
                            (
                                sid,
                                int(row.get("usage_count") or 0),
                                float(row.get("success_score") or 0.0),
                                created,
                            )
                        )
                    if _is_stale(row, cutoff=cutoff) and sid not in evicted:
                        evicted.append(sid)

    ranked = sorted(candidates, key=lambda x: (x[1], x[2], x[3]))
    if len(ranked) > MAX_SKILLS:
        overflow = len(ranked) - MAX_SKILLS
        for sid, _, _, _ in ranked[:overflow]:
            if sid not in evicted:
                evicted.append(sid)

    if not dry_run and cfg and evicted:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            for sid in evicted:
                await _arango_request(
                    client,
                    cfg=cfg,
                    method="DELETE",
                    path=f"/_api/document/{COLLECTION}/{sid}",
                )
                _MEMORY.pop(sid, None)
    elif dry_run:
        pass
    else:
        for sid in evicted:
            _MEMORY.pop(sid, None)

    logger.info("crystallization lru evicted count=%s dry_run=%s", len(evicted), dry_run)
    return {"ok": True, "evicted": evicted, "dry_run": dry_run}
