"""Planner slide_action merge — agent intent, not PHP keywords."""

from __future__ import annotations

from oaao_orchestrator.planner_llm import (
    PlannerOutputDraft,
    PlannerTaskDraft,
    _turn_reuses_prior_grounding,
    merge_planner_slide_intent,
    planner_output_to_run_plan,
)
from oaao_orchestrator.tasks.models import RunTaskType


def test_merge_planner_slide_intent_regenerate() -> None:
    draft = PlannerOutputDraft(slide_action="regenerate", use_material_id="slide-sp-old")
    cfg = merge_planner_slide_intent(
        draft,
        {"resume_project_id": "sp-old", "continuation": True},
    )
    assert cfg is not None
    assert cfg.get("regenerate_deck") is True
    assert "continuation" not in cfg
    assert "resume_project_id" not in cfg


def test_merge_planner_slide_intent_continue_from_material() -> None:
    draft = PlannerOutputDraft(
        slide_action="continue",
        use_material_id="slide-sp-abc123",
    )
    materials = [
        {
            "material_id": "slide-sp-abc123",
            "kind": "slide_project",
            "title": "Deck",
            "meta": {"project_id": "sp-abc123"},
        },
    ]
    cfg = merge_planner_slide_intent(draft, {}, conv_materials=materials)
    assert cfg is not None
    assert cfg.get("continuation") is True
    assert cfg.get("resume_project_id") == "sp-abc123"


def test_planner_output_regenerate_skips_fanout_continuation() -> None:
    draft = PlannerOutputDraft(
        tasks=[
            PlannerTaskDraft(
                id="rt-v",
                title="Vault",
                type="vault_rag",
            ),
            PlannerTaskDraft(
                id="rt-sd",
                title="Slides",
                type="agent",
                agent_kind="slide_designer",
            ),
            PlannerTaskDraft(id="rt-stream", title="Reply", type="llm_stream"),
        ],
        slide_action="regenerate",
        needs_vault_rag=True,
    )
    plan = planner_output_to_run_plan(
        draft,
        allowed_agents=["slide_designer"],
        require_vault=False,
        require_attachments=False,
        slide_designer_cfg={"resume_project_id": "sp-x", "continuation": True},
    )
    assert plan.slide_designer is not None
    assert plan.slide_designer.get("regenerate_deck") is True
    sd_tasks = [t for t in plan.tasks if t.agent_kind == "slide_designer"]
    assert len(sd_tasks) >= 1
    assert not any((t.params or {}).get("slide_phase") == "continue" for t in sd_tasks)
    assert plan.tasks[0].type == RunTaskType.VAULT_RAG


def test_reuse_turn_forces_vault_rag_when_scope_available() -> None:
    draft = PlannerOutputDraft(
        tasks=[
            PlannerTaskDraft(
                id="rt-sd",
                title="Slides",
                type="agent",
                agent_kind="slide_designer",
            ),
            PlannerTaskDraft(id="rt-stream", title="Reply", type="llm_stream"),
        ],
        slide_action="regenerate",
        use_material_id="slide-sp-handbook",
        needs_vault_rag=False,
    )
    plan = planner_output_to_run_plan(
        draft,
        allowed_agents=["slide_designer"],
        require_vault=True,
        require_attachments=False,
        slide_designer_cfg={"active_material_id": "slide-sp-handbook"},
    )
    assert any(t.type == RunTaskType.VAULT_RAG for t in plan.tasks)


def test_turn_reuses_prior_grounding_active_material() -> None:
    draft = PlannerOutputDraft()
    assert _turn_reuses_prior_grounding(
        draft,
        {"active_material_id": "slide-sp-1"},
    )
