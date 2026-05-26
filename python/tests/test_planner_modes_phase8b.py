"""ToT / DDTree planner mode unit tests (Phase 8b) — avoids Test_Suite conftest ordering."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def _plan(label: str) -> RunPlan:
    return RunPlan(
        tasks=[
            RunTaskSpec(id="1", title=f"vault for {label}", type=RunTaskType.VAULT_RAG),
            RunTaskSpec(id="2", title=f"answer {label}", type=RunTaskType.LLM_STREAM),
        ],
        abilities=[],
        report_after_task_ids=[],
    )


@pytest.mark.asyncio
async def test_refine_plan_tot_uses_accs_when_main_llm_configured(monkeypatch) -> None:
    from oaao_orchestrator.planner_modes import refine_plan_for_mode

    base = _plan("base")

    async def fake_tot_drafts(*a, **k):
        from oaao_orchestrator.planner_llm import PlannerOutputDraft, PlannerTaskDraft

        return [
            PlannerOutputDraft(
                tasks=[PlannerTaskDraft(id="1", title="t1", type="vault_rag")],
                abilities=[],
                report_after=[],
            )
        ]

    pick = AsyncMock(return_value=(base, {"tot_selection": "accs", "tot_selected_index": 0}))
    monkeypatch.setattr("oaao_orchestrator.planner_modes._tot_alternative_drafts", fake_tot_drafts)
    monkeypatch.setattr("oaao_orchestrator.planner_modes._pick_tot_plan_by_accs", pick)

    req = SimpleNamespace(messages=[{"role": "user", "content": "hi"}], chat_attachments=None)
    plan, meta = await refine_plan_for_mode(
        base,
        req=req,
        mode_id="tot",
        chat_completions_url="http://planner/v1/chat/completions",
        api_key=None,
        model="coach",
        allowed_agents=["sandbox_code"],
        main_llm_url="http://main/v1/chat/completions",
        main_api_key=None,
        main_model="main-31b",
    )
    assert meta["tot_selection"] == "accs"
    pick.assert_awaited_once()
    assert plan is base


@pytest.mark.asyncio
async def test_ddtree_respects_max_depth(monkeypatch) -> None:
    from oaao_orchestrator.planner_modes import DDTREE_MAX_DEPTH, refine_plan_for_mode

    base = _plan("root")
    depths: list[int] = []

    async def fake_expand(req, plan, *, chat_completions_url, api_key, model, messages, depth=0, meta=None):
        depths.append(depth)
        meta = dict(meta or {})
        meta["ddtree_depth"] = depth
        if depth + 1 >= DDTREE_MAX_DEPTH:
            return plan, meta
        return await fake_expand(
            req,
            plan,
            chat_completions_url=chat_completions_url,
            api_key=api_key,
            model=model,
            messages=messages,
            depth=depth + 1,
            meta=meta,
        )

    monkeypatch.setattr("oaao_orchestrator.planner_modes._ddtree_expand", fake_expand)

    req = SimpleNamespace(messages=[{"role": "user", "content": "hi"}], chat_attachments=None)
    _, meta = await refine_plan_for_mode(
        base,
        req=req,
        mode_id="ddtree",
        chat_completions_url="http://planner/v1/chat/completions",
        api_key=None,
        model="coach",
        allowed_agents=[],
    )
    assert meta["ddtree_depth"] == DDTREE_MAX_DEPTH - 1
    assert depths == [0, 1, 2]


@pytest.mark.asyncio
async def test_tot_picks_highest_accs_candidate(monkeypatch) -> None:
    from oaao_orchestrator.planner_modes import _pick_tot_plan_by_accs

    candidates = [_plan("a"), _plan("b"), _plan("c")]
    scores = [0.55, 0.91, 0.72]
    call_idx = {"n": 0}

    async def fake_probe(*args, **kwargs):
        return f"probe-{call_idx['n']}"

    async def fake_accs(*, user_message, llm_output, coach_endpoint=None, evidence=None):
        from oaao_orchestrator.evaluation.accs import ACCSResult

        idx = call_idx["n"]
        call_idx["n"] += 1
        return ACCSResult(score=scores[idx], factors={}, action="ship", source="test")

    monkeypatch.setattr("oaao_orchestrator.planner_modes._execute_tot_candidate_probe", fake_probe)
    monkeypatch.setattr("oaao_orchestrator.evaluation.accs.score_accs", fake_accs)

    best, meta = await _pick_tot_plan_by_accs(
        candidates,
        user_msg="compare X and Y",
        messages=[{"role": "user", "content": "compare X and Y"}],
        main_llm_url="http://fake/v1/chat/completions",
        api_key=None,
        model="main",
        coach_endpoint=None,
        run=None,
    )
    assert meta["tot_selected_index"] == 1
    assert meta["tot_selection"] == "accs"
    assert meta["tot_selected_score"] == pytest.approx(0.91)
    assert best.tasks[1].title == "answer b"


def test_pick_base_url_accepts_planner_mode_id_dict_ctx() -> None:
    """Regression: preamble passes dict ctx (class-body ``planner_mode_id = planner_mode_id`` NameError)."""
    from oaao_orchestrator.endpoint import pick_base_url

    cfg = {
        "base_urls": ["http://box1:9000", "http://box2:9000"],
        "routing_policy": "tiered",
    }
    assert (
        pick_base_url(
            cfg,
            ctx={"planner_mode_id": "tot", "purpose_id": "chat"},
        )
        == "http://box1:9000"
    )
    assert (
        pick_base_url(
            cfg,
            ctx={"planner_mode_id": "default", "purpose_id": "chat"},
        )
        == "http://box2:9000"
    )
