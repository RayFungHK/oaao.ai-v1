"""Slide designer — requires_ask before deck build."""

from __future__ import annotations

from oaao_orchestrator.planner_llm import (
    ensure_slide_designer_requires_ask,
    inject_slide_designer_for_teaching_intent,
)
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


def test_template_inject_sets_requires_ask() -> None:
    specs = inject_slide_designer_for_teaching_intent(
        [
            RunTaskSpec(id="rt-vault", title="Vault", type=RunTaskType.VAULT_RAG),
            RunTaskSpec(id="rt-stream", title="Reply", type=RunTaskType.LLM_STREAM),
        ],
        allowed_agents=["vault_rag", "slide_designer"],
        messages=[{"role": "user", "content": "Handbook vol 3"}],
        slide_designer_cfg={"template_id": "import_test_tpl"},
    )
    sd = next(s for s in specs if s.agent_kind == "slide_designer")
    assert sd.params.get("requires_ask") is True
    assert str(sd.params.get("ask_message") or "").strip()


def test_ensure_requires_ask_on_planner_slide_row() -> None:
    specs = [
        RunTaskSpec(
            id="rt-sd",
            title="Slides",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            params={},
        ),
    ]
    out = ensure_slide_designer_requires_ask(
        specs,
        messages=[{"role": "user", "content": "Explain compliance"}],
        slide_designer_cfg=None,
    )
    assert out[0].params.get("requires_ask") is True
