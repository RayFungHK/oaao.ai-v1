from pathlib import Path

from oaao_orchestrator.prompt_template import (
    load_template_body,
    prompt_config_from_purpose_payload,
    render_template_text,
    resolve_template_path,
)


def test_resolve_planning_planner_system_md() -> None:
    path = resolve_template_path("materials/prompts/planning/planner_system.md")
    assert path is not None
    assert path.name == "planner_system.md"


def test_render_planner_system_variables() -> None:
    body = load_template_body(ref="materials/prompts/planning/planner_system.md")
    out = render_template_text(
        body,
        {
            "allowed_agents": "web_search, vault_rag",
            "max_tasks": "8",
            "agent_guide": "- web_search: public web",
        },
    )
    assert "web_search, vault_rag" in out
    assert "At most 8 tasks" in out
    assert "public web" in out


def test_prompt_config_from_planner_payload() -> None:
    cfg = prompt_config_from_purpose_payload(
        {
            "purpose_key": "planning.primary",
            "prompt": {
                "kind": "conversation",
                "system_ref": "materials/prompts/planning/planner_system.md",
            },
        }
    )
    assert cfg is not None
    assert cfg["kind"] == "conversation"
