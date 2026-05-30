"""P1 — planner_prompt_block injection into planning templates."""

from oaao_orchestrator.planning_prompt import render_planner_system_prompt


def test_render_planner_system_prompt_includes_numbered_block() -> None:
    out = render_planner_system_prompt(
        allowed_agents=["slide_designer"],
        max_tasks=6,
        agent_guide="slide_designer: decks",
        planner_prompt_block="1. vault: Prefer scoped retrieval when vault_scope=yes.",
    )
    assert "1. vault: Prefer scoped retrieval" in out
    assert "slide_designer: decks" in out
