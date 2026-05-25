"""Daily evolution report job (Evolution §7.2)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from oaao_orchestrator.evaluation.evolution_store import (
    list_low_score_cases,
    record_evolution_patch,
    record_evolution_report,
)

logger = logging.getLogger(__name__)


async def run_daily_report(*, sample_limit: int = 20) -> dict[str, Any]:
    """
    Analyze recent low-score cases and produce a report (not auto-applied).

    Returns summary dict suitable for admin API / cron logs.
    """
    cases = list_low_score_cases(limit=sample_limit)
    iqs_killers: dict[str, int] = {}
    accs_by_agent: dict[str, int] = {}
    for row in cases:
        action = str(row.get("iqs_action") or "")
        if action:
            iqs_killers[action] = iqs_killers.get(action, 0) + 1
        for kind in row.get("tool_chain") or []:
            k = str(kind)
            accs_by_agent[k] = accs_by_agent.get(k, 0) + 1

    report_id = f"daily-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    report = {
        "report_id": report_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sample_count": len(cases),
        "top_iqs_killers": sorted(iqs_killers.items(), key=lambda x: -x[1])[:10],
        "top_accs_agent_kinds": sorted(accs_by_agent.items(), key=lambda x: -x[1])[:10],
        "suggested_patches": [],
        "status": "pending_review",
    }
    if iqs_killers.get("clarify", 0) >= 5:
        report["suggested_patches"].append(
            {
                "type": "system_prompt",
                "diff": "+ Assume reasonable defaults when user intent is partial.\n",
                "repeat_count": iqs_killers.get("clarify", 0),
            }
        )
    logger.info("daily evolution report id=%s samples=%s", report_id, len(cases))
    await record_evolution_report(report)
    return report


async def run_weekly_auto_apply(*, min_repeat: int = 5) -> dict[str, Any]:
    """Conservative auto-apply for repeated small prompt patches (Evolution §7.3)."""
    report = await run_daily_report()
    applied: list[str] = []
    for patch in report.get("suggested_patches") or []:
        if not isinstance(patch, dict):
            continue
        if patch.get("type") != "system_prompt":
            continue
        if int(patch.get("repeat_count") or 0) < min_repeat:
            continue
        diff = str(patch.get("diff") or "")
        if diff.count("\n") > 5:
            continue
        patch_id = f"auto-{datetime.now(timezone.utc).strftime('%Y%m%d')}-iqs-clarity"
        await record_evolution_patch(
            {
                "patch_id": patch_id,
                "type": "system_prompt",
                "applied_at": datetime.now(timezone.utc).isoformat(),
                "diff": diff,
                "source_report_id": report.get("report_id"),
                "auto_generated": True,
                "rollback_command": f"POST /admin/evolution/rollback/{patch_id}",
            }
        )
        applied.append(patch_id)
    return {"applied": applied, "report_id": report.get("report_id")}
