"""Daily evolution report job (Evolution §7.2)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from oaao_orchestrator.evaluation.auto_fewshot import write_auto_fewshot
from oaao_orchestrator.evaluation.evolution_store import (
    list_evolution_reports,
    list_evolution_runs,
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
    fewshot_candidates: list[dict[str, str]] = []
    for row in cases:
        action = str(row.get("iqs_action") or "")
        if action:
            iqs_killers[action] = iqs_killers.get(action, 0) + 1
        for kind in row.get("tool_chain") or []:
            k = str(kind)
            accs_by_agent[k] = accs_by_agent.get(k, 0) + 1
        if action == "clarify":
            um = str(row.get("user_message") or row.get("input") or "").strip()
            if um:
                fewshot_candidates.append(
                    {
                        "bad_input": um,
                        "corrected_input": f"{um} (assume reasonable defaults)",
                    }
                )

    for row in list_evolution_runs(limit=sample_limit * 10):
        action = str(row.get("iqs_action") or "")
        if action:
            iqs_killers[action] = iqs_killers.get(action, 0) + 1

    report_id = f"daily-{datetime.now(UTC).strftime('%Y-%m-%d')}"
    report = {
        "report_id": report_id,
        "generated_at": datetime.now(UTC).isoformat(),
        "sample_count": len(cases),
        "top_iqs_killers": sorted(iqs_killers.items(), key=lambda x: -x[1])[:10],
        "top_accs_agent_kinds": sorted(accs_by_agent.items(), key=lambda x: -x[1])[:10],
        "suggested_patches": [],
        "fewshot_candidates": fewshot_candidates[:10],
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


def _reports_in_last_days(days: int = 7) -> list[dict[str, Any]]:
    cutoff = datetime.now(UTC) - timedelta(days=max(1, days))
    out: list[dict[str, Any]] = []
    for row in list_evolution_reports(limit=200):
        gen = str(row.get("generated_at") or "")
        try:
            ts = datetime.fromisoformat(gen.replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts >= cutoff:
            out.append(row)
    return out


def _aggregate_suggested_patches(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for rep in reports:
        for patch in rep.get("suggested_patches") or []:
            if not isinstance(patch, dict):
                continue
            key = f"{patch.get('type')}:{patch.get('diff')}"
            if key not in counts:
                counts[key] = dict(patch)
                counts[key]["repeat_count"] = int(patch.get("repeat_count") or 0)
            else:
                counts[key]["repeat_count"] = int(counts[key].get("repeat_count") or 0) + int(
                    patch.get("repeat_count") or 0
                )
    return list(counts.values())


async def run_weekly_auto_apply(*, min_repeat: int = 5) -> dict[str, Any]:
    """Conservative auto-apply from past 7 days of daily reports (Evolution §7.3)."""
    weekly_reports = _reports_in_last_days(7)
    if not weekly_reports:
        report = await run_daily_report()
        weekly_reports = [report]
    aggregated = _aggregate_suggested_patches(weekly_reports)
    applied: list[str] = []
    fewshot_written = 0
    for patch in aggregated:
        if not isinstance(patch, dict):
            continue
        if patch.get("type") != "system_prompt":
            continue
        if int(patch.get("repeat_count") or 0) < min_repeat:
            continue
        diff = str(patch.get("diff") or "")
        if diff.count("\n") > 5:
            continue
        patch_id = f"auto-{datetime.now(UTC).strftime('%Y%m%d')}-iqs-clarity"
        await record_evolution_patch(
            {
                "patch_id": patch_id,
                "type": "system_prompt",
                "status": "applied",
                "applied_at": datetime.now(UTC).isoformat(),
                "diff": diff,
                "source_report_id": weekly_reports[0].get("report_id") if weekly_reports else None,
                "auto_generated": True,
                "rollback_command": f"POST /admin/evolution/rollback/{patch_id}",
            }
        )
        applied.append(patch_id)

    for rep in weekly_reports:
        clarify_count = 0
        for action, cnt in rep.get("top_iqs_killers") or []:
            if str(action) == "clarify":
                clarify_count = int(cnt)
        if clarify_count < 3:
            continue
        for row in rep.get("fewshot_candidates") or []:
            if not isinstance(row, dict):
                continue
            ok = await write_auto_fewshot(
                bad_input=str(row.get("bad_input") or ""),
                corrected_input=str(row.get("corrected_input") or ""),
                report_id=str(rep.get("report_id") or ""),
            )
            if ok:
                fewshot_written += 1

    return {
        "applied": applied,
        "fewshot_written": fewshot_written,
        "reports_considered": len(weekly_reports),
        "aggregated_patches": len(aggregated),
    }
