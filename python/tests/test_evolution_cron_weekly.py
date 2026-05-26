"""Evolution cron + weekly apply contracts — Phase 11."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from oaao_orchestrator.evaluation.daily_report import run_weekly_auto_apply
from oaao_orchestrator.evaluation.evolution_store import record_evolution_report, update_evolution_report


@pytest.mark.asyncio
async def test_weekly_auto_apply_aggregates_seven_day_reports(monkeypatch) -> None:
    now = datetime.now(UTC)
    for i in range(6):
        await record_evolution_report(
            {
                "report_id": f"daily-old-{i}",
                "generated_at": (now - timedelta(days=i + 1)).isoformat(),
                "suggested_patches": [
                    {
                        "type": "system_prompt",
                        "diff": "+ Assume reasonable defaults when user intent is partial.\n",
                        "repeat_count": 1,
                    }
                ],
                "top_iqs_killers": [["clarify", 1]],
                "fewshot_candidates": [],
                "status": "pending_review",
            }
        )
    await record_evolution_report(
        {
            "report_id": "daily-recent",
            "generated_at": now.isoformat(),
            "suggested_patches": [
                {
                    "type": "system_prompt",
                    "diff": "+ Assume reasonable defaults when user intent is partial.\n",
                    "repeat_count": 5,
                }
            ],
            "top_iqs_killers": [["clarify", 5]],
            "fewshot_candidates": [
                {"bad_input": "help", "corrected_input": "help (assume defaults)"},
            ],
            "status": "pending_review",
        }
    )

    fewshot_calls: list[str] = []

    async def fake_fewshot(**kwargs):
        fewshot_calls.append(str(kwargs.get("report_id")))
        return True

    monkeypatch.setattr(
        "oaao_orchestrator.evaluation.daily_report.write_auto_fewshot",
        fake_fewshot,
    )

    result = await run_weekly_auto_apply(min_repeat=5)
    assert result["reports_considered"] >= 1
    assert result["applied"]
    assert result["fewshot_written"] >= 1


@pytest.mark.asyncio
async def test_evolution_report_review_updates_status() -> None:
    from oaao_orchestrator.evaluation.evolution_store import update_evolution_report_persisted

    await record_evolution_report(
        {
            "report_id": "daily-review-me",
            "generated_at": "2026-05-26T00:00:00+00:00",
            "status": "pending_review",
            "sample_count": 1,
            "suggested_patches": [],
        }
    )
    updated = await update_evolution_report_persisted("daily-review-me", status="reviewed")
    assert updated is not None
    assert updated["status"] == "reviewed"
    row = update_evolution_report("daily-review-me")
    assert row is not None
    assert row["status"] == "reviewed"
