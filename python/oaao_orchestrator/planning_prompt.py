"""Task planner prompts — conversation system + report replan (``materials/prompts/planning/*.md``).

Like :mod:`polish_prompt`, behavior is tuned by editing markdown on disk — not Python strings.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from oaao_orchestrator.prompt_template import (
    load_template_body,
    prompt_config_from_purpose_payload,
    render_template_text,
    resolve_template_path,
)

logger = logging.getLogger(__name__)

DEFAULT_PLANNER_SYSTEM_REF = "materials/prompts/planning/planner_system.md"
DEFAULT_REPORT_SYSTEM_REF = "materials/prompts/planning/planner_report_result.md"

_PLANNER_FALLBACK = (
    "You are a task planner. Output ONLY valid JSON. "
    "Allowed agents: {{allowed_agents}}. At most {{max_tasks}} tasks. "
    "{{agent_guide}}"
)

_REPORT_FALLBACK = (
    "Decide whether to append follow-up run tasks before llm_stream. "
    "Output ONLY JSON: {\"append\": []}. Allowed agents:\n{{agent_guide}}"
)


def _planning_search_refs(*extra: str) -> tuple[str, ...]:
    refs: list[str] = []
    for raw in (
        os.environ.get("OAAO_PLANNER_SYSTEM_REF", "").strip(),
        DEFAULT_PLANNER_SYSTEM_REF,
        *extra,
    ):
        if raw:
            refs.append(raw)
    return tuple(refs)


def load_planner_system_body(*, ref: str = "") -> str:
    return load_template_body(
        ref=ref or DEFAULT_PLANNER_SYSTEM_REF,
        fallback=_PLANNER_FALLBACK,
        extra_refs=_planning_search_refs(),
    )


def load_report_system_body(*, ref: str = "") -> str:
    return load_template_body(
        ref=ref or DEFAULT_REPORT_SYSTEM_REF,
        fallback=_REPORT_FALLBACK,
        extra_refs=(
            os.environ.get("OAAO_PLANNER_REPORT_SYSTEM_REF", "").strip(),
            DEFAULT_REPORT_SYSTEM_REF,
        ),
    )


def _system_ref_from_planner_payload(planner_payload: dict[str, Any] | None) -> str:
    prompt_cfg = prompt_config_from_purpose_payload(
        planner_payload if isinstance(planner_payload, dict) else None
    )
    if isinstance(prompt_cfg, dict) and str(prompt_cfg.get("kind") or "") == "conversation":
        ref = str(prompt_cfg.get("system_ref") or "").strip()
        if ref:
            return ref
    env = os.environ.get("OAAO_PLANNER_SYSTEM_REF", "").strip()
    return env or DEFAULT_PLANNER_SYSTEM_REF


def render_planner_system_prompt(
    *,
    allowed_agents: list[str],
    max_tasks: int,
    agent_guide: str,
    planner_payload: dict[str, Any] | None = None,
) -> str:
    """Conversation system prompt for ``planning.primary``."""
    agents_s = ", ".join(allowed_agents) if allowed_agents else "(none)"
    guide_block = agent_guide.strip() if agent_guide.strip() else "(none)"
    ref = _system_ref_from_planner_payload(planner_payload)
    body = load_planner_system_body(ref=ref)
    return render_template_text(
        body,
        {
            "allowed_agents": agents_s,
            "max_tasks": str(max_tasks),
            "agent_guide": guide_block,
        },
    )


def render_report_system_prompt(*, agent_guide: str) -> str:
    """Conversation system prompt for report-result replan."""
    guide_block = agent_guide.strip() if agent_guide.strip() else "(none)"
    body = load_report_system_body()
    return render_template_text(body, {"agent_guide": guide_block})


def resolve_planner_system_path(ref: str = "") -> str | None:
    path = resolve_template_path(ref or DEFAULT_PLANNER_SYSTEM_REF, extra_refs=_planning_search_refs())
    return str(path) if path is not None else None
