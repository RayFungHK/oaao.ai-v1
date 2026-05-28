"""WS-1-S5 — scheduled orientation-driven web search refresh into Knowledge buckets."""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.knowledge.asset_store import persist_web_search_capture
from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.orientation_store import (
    load_orientation_scoped,
    orientation_store_dir,
)
from oaao_orchestrator.knowledge.promotion import schedule_web_knowledge_promotion
from oaao_orchestrator.knowledge.scope import KnowledgeScopeRef, parse_tenant_id
from oaao_orchestrator.knowledge.topic_lifecycle import (
    filter_scheduled_queries,
    record_search_outcome,
    refresh_scopes_mode,
)
from oaao_orchestrator.knowledge.search_plan import execute_search_plan

logger = logging.getLogger(__name__)

_TENANT_FILE = re.compile(r"^tenant_(\d+)\.json$")


def refresh_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_REFRESH_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def refresh_interval_hours(knowledge: dict[str, Any] | None = None) -> float:
    from oaao_orchestrator.knowledge.refresh_settings import refresh_settings_from_knowledge

    return refresh_settings_from_knowledge(knowledge).interval_hours


def refresh_max_queries() -> int:
    raw = (os.environ.get("OAAO_KNOWLEDGE_REFRESH_MAX_QUERIES") or "4").strip()
    try:
        return max(1, min(8, int(raw)))
    except ValueError:
        return 4


def system_user_id_for_refresh(knowledge: dict[str, Any] | None = None) -> int | None:
    if isinstance(knowledge, dict):
        refresh = knowledge.get("refresh")
        if isinstance(refresh, dict):
            raw_uid = refresh.get("refresh_user_id")
            if raw_uid is not None:
                try:
                    uid = int(raw_uid)
                    if uid > 0:
                        return uid
                except (TypeError, ValueError):
                    pass
        raw_top = knowledge.get("refresh_user_id")
        if raw_top is not None:
            try:
                uid = int(raw_top)
                if uid > 0:
                    return uid
            except (TypeError, ValueError):
                pass
    raw = (os.environ.get("OAAO_KNOWLEDGE_REFRESH_USER_ID") or "").strip()
    if not raw:
        return None
    try:
        uid = int(raw)
        return uid if uid > 0 else None
    except ValueError:
        return None


@dataclass
class RefreshScopeResult:
    scope: str
    tenant_id: int | None = None
    skipped: bool = False
    skip_reason: str = ""
    queries_run: int = 0
    hits_count: int = 0
    asset_id: str | None = None
    errors: list[str] = field(default_factory=list)


def discover_refresh_scope_refs() -> list[KnowledgeScopeRef]:
    """Platform evolution scope by default; legacy tenant_* when OAAO_KNOWLEDGE_REFRESH_SCOPES=all."""
    refs: list[KnowledgeScopeRef] = []
    root = orientation_store_dir()
    if not root.is_dir():
        return refs
    if (root / "platform.json").is_file():
        refs.append(KnowledgeScopeRef(scope="platform"))
    elif refresh_scopes_mode() == "platform":
        refs.append(KnowledgeScopeRef(scope="platform"))
    if refresh_scopes_mode() != "all":
        return refs
    for path in sorted(root.glob("tenant_*.json")):
        m = _TENANT_FILE.match(path.name)
        if not m:
            continue
        tid = int(m.group(1))
        if tid > 0:
            refs.append(KnowledgeScopeRef(scope="tenant", tenant_id=tid))
    return refs


def _orientation_for_ref(ref: KnowledgeScopeRef) -> OrientationJsonV1 | None:
    return load_orientation_scoped(ref)


def should_refresh_scope(
    ref: KnowledgeScopeRef,
    *,
    force: bool = False,
    knowledge: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    if force:
        return True, "forced"
    orient = _orientation_for_ref(ref)
    if orient is None:
        return False, "no_orientation"
    updated = float(orient.updated_at or 0)
    if updated <= 0:
        return True, "never_refreshed"
    age_h = (time.time() - updated) / 3600.0
    if age_h >= refresh_interval_hours(knowledge):
        return True, f"stale_{age_h:.1f}h"
    return False, f"fresh_{age_h:.1f}h"


def build_scheduled_search_plan(
    orientation: OrientationJsonV1 | None,
    *,
    knowledge: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Orientation-only plan (no user turn) for cron refresh."""
    from oaao_orchestrator.knowledge.refresh_settings import refresh_settings_from_knowledge

    settings = refresh_settings_from_knowledge(knowledge)
    queries: list[dict[str, Any]] = []
    cap = refresh_max_queries()
    blocked: set[str] = {t.strip().lower() for t in settings.do_not_search if t.strip()}
    if orientation is not None:
        blocked |= {t.strip().lower() for t in orientation.do_not_search if t.strip()}
        for sq in orientation.search_queries_suggested[:cap]:
            q = str(sq or "").strip()
            if not q:
                continue
            if any(b in q.lower() for b in blocked if b):
                continue
            queries.append(
                {
                    "q": q[:500],
                    "provider": "searxng",
                    "reason": "scheduled_refresh",
                }
            )
        if not queries and orientation.topics:
            for topic in orientation.topics[:cap]:
                t = str(topic or "").strip()
                if t:
                    queries.append(
                        {
                            "q": t[:500],
                            "provider": "searxng",
                            "reason": "scheduled_topic",
                        }
                    )
    gated, skipped = filter_scheduled_queries(queries[:cap], orientation)
    return {
        "version": 1,
        "method": "scheduled_refresh",
        "queries": gated,
        "skipped_topics": skipped,
        "orientation_snapshot": orientation.model_dump() if orientation else None,
    }


async def refresh_knowledge_scope(
    ref: KnowledgeScopeRef,
    *,
    force: bool = False,
    knowledge: dict[str, Any] | None = None,
    user_id: int | None = None,
    schedule_promotion: bool = True,
) -> RefreshScopeResult:
    """Run one tenant/platform refresh cycle."""
    result = RefreshScopeResult(
        scope=ref.scope,
        tenant_id=ref.tenant_id,
    )
    if not refresh_enabled():
        result.skipped = True
        result.skip_reason = "refresh_disabled"
        return result

    ok, reason = should_refresh_scope(ref, force=force, knowledge=knowledge)
    if not ok:
        result.skipped = True
        result.skip_reason = reason
        return result

    orient = _orientation_for_ref(ref)
    plan = build_scheduled_search_plan(orient, knowledge=knowledge)
    result.queries_run = len(plan.get("queries") or [])
    if result.queries_run < 1:
        result.skipped = True
        result.skip_reason = "no_queries"
        return result

    try:
        hits = await execute_search_plan(plan, limit_per_query=5)
    except Exception as exc:
        result.errors.append(str(exc)[:200])
        result.skip_reason = "search_failed"
        return result

    result.hits_count = len(hits)
    if not hits:
        result.skipped = True
        result.skip_reason = "zero_hits"
        if orient is not None:
            for row in plan.get("queries") or []:
                q = str(row.get("q") or "").strip()
                if q:
                    record_search_outcome(orient, query=q, hits_count=0, new_content_ratio=0.0)
            from oaao_orchestrator.knowledge.orientation_store import save_orientation

            save_orientation(orient)
        return result

    topics = list(orient.topics[:12]) if orient else []
    asset = await persist_web_search_capture(
        scope_ref=ref,
        search_plan=plan,
        hits=hits,
        orientation_topics=topics,
        tier="tenant",
    )
    if asset is None:
        result.skipped = True
        result.skip_reason = "persist_failed"
        return result

    result.asset_id = asset.asset_id
    result.skip_reason = reason

    if orient is not None:
        new_ratio = min(1.0, len(hits) / max(1, result.queries_run * 3))
        for row in plan.get("queries") or []:
            q = str(row.get("q") or "").strip()
            if q:
                record_search_outcome(
                    orient,
                    query=q,
                    hits_count=len(hits),
                    new_content_ratio=new_ratio,
                )
        from oaao_orchestrator.knowledge.orientation_store import save_orientation

        save_orientation(orient)

    if schedule_promotion and asset.asset_id:
        uid = user_id or system_user_id_for_refresh(knowledge)
        if uid and uid > 0:
            schedule_web_knowledge_promotion(
                asset_id=asset.asset_id,
                user_id=uid,
                knowledge=knowledge,
                workspace_id=ref.workspace_id,
            )
        else:
            logger.info(
                "refresh promotion skipped — set OAAO_KNOWLEDGE_REFRESH_USER_ID for vault ingest"
            )
        from oaao_orchestrator.knowledge.distill_worker import schedule_classify_distill_asset

        schedule_classify_distill_asset(asset.asset_id, knowledge=knowledge)

    return result


async def run_knowledge_refresh_batch(
    *,
    tenant_id: int | None = None,
    scope: str | None = None,
    force: bool = False,
    knowledge: dict[str, Any] | None = None,
    user_id: int | None = None,
    classify_after: bool | None = None,
) -> dict[str, Any]:
    """Refresh one scope or all discovered orientations."""
    from oaao_orchestrator.knowledge.distill_worker import classify_distill_pending_assets
    from oaao_orchestrator.knowledge.refresh_settings import refresh_settings_from_knowledge

    settings = refresh_settings_from_knowledge(knowledge)
    if not settings.scheduled_enabled and not force:
        return {
            "ok": True,
            "skipped": True,
            "reason": "scheduled_disabled",
            "refresh": settings.__dict__,
        }

    do_classify = (
        settings.classify_after if classify_after is None else bool(classify_after)
    )

    targets: list[KnowledgeScopeRef] = []
    forced_scope = (scope or "").strip().lower()
    tid = parse_tenant_id(tenant_id)
    if forced_scope == "platform":
        targets = [KnowledgeScopeRef(scope="platform")]
    elif tid:
        targets = [KnowledgeScopeRef(scope="tenant", tenant_id=tid)]
    else:
        targets = discover_refresh_scope_refs()

    results: list[dict[str, Any]] = []
    for ref in targets:
        row = await refresh_knowledge_scope(
            ref,
            force=force,
            knowledge=knowledge,
            user_id=user_id,
            schedule_promotion=True,
        )
        results.append(
            {
                "scope": row.scope,
                "tenant_id": row.tenant_id,
                "skipped": row.skipped,
                "skip_reason": row.skip_reason,
                "queries_run": row.queries_run,
                "hits_count": row.hits_count,
                "asset_id": row.asset_id,
                "errors": row.errors,
            }
        )

    classify_summary: dict[str, Any] | None = None
    if do_classify:
        classify_summary = await classify_distill_pending_assets(
            tenant_id=tid,
            knowledge=knowledge,
            limit=20,
        )

    return {
        "ok": True,
        "refreshed": len([r for r in results if not r.get("skipped")]),
        "results": results,
        "classify": classify_summary,
        "refresh_settings": {
            "scheduled_enabled": settings.scheduled_enabled,
            "interval_hours": settings.interval_hours,
            "classify_after": do_classify,
        },
    }
