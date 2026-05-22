"""SD-4 — slide designer plan fan-out."""

from __future__ import annotations

from oaao_orchestrator.planner_llm import (
    apply_slide_continuation_to_specs,
    apply_slide_fanout_to_specs,
)
from oaao_orchestrator.slide_project.fanout import (
    detect_slide_page_count,
    expand_slide_designer_fanout,
)
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType


def test_detect_slide_page_count_from_user_message() -> None:
    n = detect_slide_page_count([{"role": "user", "content": "幫我做 12 頁的產品簡報"}])
    assert n == 12


def test_expand_slide_designer_fanout_creates_parallel_pages() -> None:
    tasks = [
        RunTaskSpec(
            id="rt-slides",
            title="Build deck",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
        ),
        RunTaskSpec(id="rt-stream", title="Reply", type=RunTaskType.LLM_STREAM),
    ]
    expanded = expand_slide_designer_fanout(
        tasks,
        [{"role": "user", "content": "Make a 5 page slide deck about OAAO"}],
    )
    kinds = [t for t in expanded if t.agent_kind == "slide_designer"]
    assert len(kinds) >= 7  # outline + 5 pages + export
    pages = [t for t in kinds if (t.params or {}).get("slide_phase") == "page"]
    assert len(pages) == 5
    assert all(t.parallel_ok for t in pages)


def test_expand_slide_designer_fanout_skips_on_continuation() -> None:
    tasks = [
        RunTaskSpec(
            id="rt-slides",
            title="Build deck",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
        ),
    ]
    expanded = expand_slide_designer_fanout(
        tasks,
        [{"role": "user", "content": "Continue editing the deck"}],
        continuation=True,
    )
    assert len(expanded) == 1
    assert (expanded[0].params or {}).get("slide_phase") is None


def test_apply_slide_continuation_requires_continuation_flag() -> None:
    specs = [
        RunTaskSpec(
            id="rt-slides",
            title="Continue deck",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
        ),
    ]
    out = apply_slide_continuation_to_specs(
        specs,
        {"resume_project_id": "sp-abc123"},
    )
    assert (out[0].params or {}).get("slide_phase") is None
    out2 = apply_slide_continuation_to_specs(
        specs,
        {"continuation": True, "resume_project_id": "sp-abc123"},
    )
    assert (out2[0].params or {}).get("slide_phase") == "continue"
    assert (out2[0].params or {}).get("project_id") == "sp-abc123"


def test_apply_slide_continuation_sets_continue_phase() -> None:
    specs = [
        RunTaskSpec(
            id="rt-slides",
            title="Continue deck",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
        ),
    ]
    out = apply_slide_continuation_to_specs(
        specs,
        {"continuation": True, "resume_project_id": "slide-sp-abc123"},
    )
    assert (out[0].params or {}).get("slide_phase") == "continue"
    assert (out[0].params or {}).get("project_id") == "slide-sp-abc123"
    fanout = apply_slide_fanout_to_specs(
        out,
        [{"role": "user", "content": "Add two more slides"}],
        {"continuation": True, "resume_project_id": "slide-sp-abc123"},
    )
    slide_tasks = [t for t in fanout if t.agent_kind == "slide_designer"]
    assert len(slide_tasks) == 1
    assert (slide_tasks[0].params or {}).get("slide_phase") == "continue"


def test_task_list_payload_groups_slide_pages_under_workers_parent() -> None:
    pages = [
        RunTaskSpec(
            id=f"rt-slides-slide-{n:02d}",
            title=f"Slide {n}/3",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            parallel_ok=True,
            status=RunTaskStatus.DONE if n < 3 else RunTaskStatus.ACTIVE,
            params={"slide_phase": "page", "slide_group": "rt-slides", "slide_index": n},
        )
        for n in range(1, 4)
    ]
    plan = RunPlan(
        tasks=[
            RunTaskSpec(
                id="rt-slides-outline",
                title="Outline",
                type=RunTaskType.AGENT,
                agent_kind="slide_designer",
                params={"slide_phase": "outline", "slide_group": "rt-slides"},
            ),
            *pages,
            RunTaskSpec(
                id="rt-slides-export",
                title="Export",
                type=RunTaskType.AGENT,
                agent_kind="slide_designer",
                params={"slide_phase": "export", "slide_group": "rt-slides"},
            ),
        ]
    )
    payload = plan.task_list_payload()
    ids = [row["id"] for row in payload["items"]]
    assert ids == ["rt-slides-outline", "rt-slides-slides", "rt-slides-export"]
    workers = next(r for r in payload["items"] if r["id"] == "rt-slides-slides")
    assert workers.get("slide_workers") is True
    assert len(workers.get("agent_tasks") or []) == 3
    assert workers["agent_tasks"][2]["title"] == "Slide 3/3"
