"""Per-turn agent intent hook — registry-driven command template (``planning.intent``).

Renders ``turn_agent_intent.md`` with dynamic analysis keys from ``allowed_agents`` /
``agent_catalog`` (like polish template prompts — no inline prose in Python).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from oaao_orchestrator.planner_catalog import catalog_from_request
from oaao_orchestrator.prompt_template import (
    command_template_ref,
    load_template_body,
    polish_templates_dir,
    prompt_config_from_purpose_payload,
    prompts_subdir,
    render_template_text,
)

logger = logging.getLogger(__name__)

DEFAULT_INTENT_TEMPLATE_REF = "materials/prompts/planning/turn_agent_intent.md"
DEFAULT_WEB_THRESHOLD = 0.65
DEFAULT_SLIDE_THRESHOLD = 0.65

# Task types / prepare steps — not scored on the intent hook (planner decides directly).
_INTENT_HOOK_SKIP: frozenset[str] = frozenset({"vault_rag", "attachments", "llm_stream", "llm_call", "emit"})

# Agent kinds always eligible for planning.intent scoring (union with allowed_agents).
_INTENT_SCORING_KINDS: tuple[str, ...] = ("web_search", "slide_designer", "office_generate")
_INTENT_AGENT_HINTS: dict[str, str] = {
    "web_search": (
        "User input has provided date and the latest LLM Knowledge date is not fulfilled; "
        "or user request to fetch the data from web or online; "
        "or the LLM has less knowledge to provide solution; "
        "or user requesting latest information."
    ),
    "slide_designer": "User requesting to create slides or presentation.",
    "office_generate": "User requesting to create or export docs, PDF, XLSX, or any document file.",
    "sandbox_code": "User needs isolated code execution, data processing scripts, or programmatic analysis.",
    "image_gen": "User requests image generation from a text prompt.",
    "mcp_tool": "User needs an external integration or MCP tool call.",
    "library_search": "User needs attach-only library document retrieval (not public web).",
}


def _web_threshold() -> float:
    try:
        return max(0.0, min(1.0, float(os.environ.get("OAAO_TURN_INTENT_WEB_THRESHOLD", str(DEFAULT_WEB_THRESHOLD)))))
    except (TypeError, ValueError):
        return DEFAULT_WEB_THRESHOLD


def _slide_threshold() -> float:
    try:
        return max(
            0.0,
            min(1.0, float(os.environ.get("OAAO_TURN_INTENT_SLIDE_THRESHOLD", str(DEFAULT_SLIDE_THRESHOLD)))),
        )
    except (TypeError, ValueError):
        return DEFAULT_SLIDE_THRESHOLD


def intent_hook_agent_kinds(req: object | None, *, allowed_agents: list[str] | None = None) -> list[str]:
    """Agent kinds to include in the intent JSON schema (registry order preserved)."""
    raw: list[str] = []
    if allowed_agents:
        raw = [str(a).strip() for a in allowed_agents if str(a).strip()]
    elif req is not None:
        allowed = getattr(req, "allowed_agents", None) or []
        if isinstance(allowed, list):
            raw = [str(a).strip() for a in allowed if str(a).strip()]
    if not raw:
        raw = list(_INTENT_SCORING_KINDS)
    seen: set[str] = set()
    out: list[str] = []
    for kind in raw:
        if kind in _INTENT_HOOK_SKIP or kind in seen:
            continue
        seen.add(kind)
        out.append(kind)
    cat = catalog_from_request(req)
    for kind in _INTENT_SCORING_KINDS:
        if kind in seen or kind in _INTENT_HOOK_SKIP:
            continue
        if kind in cat:
            seen.add(kind)
            out.append(kind)
    return out or ["web_search"]


def build_intent_analysis_schema(agent_kinds: list[str]) -> str:
    """JSON example block for the command template."""
    analysis = {k: 0.0 for k in agent_kinds}
    reasoning = {k: "" for k in agent_kinds}
    return json.dumps({"analysis": analysis, "reasoning": reasoning}, indent=2, ensure_ascii=False)


def _intent_hint_for_kind(kind: str, entry: Any | None) -> str:
    if entry is not None:
        hint = str(getattr(entry, "description", "") or "").strip()
        if hint:
            return hint
    return _INTENT_AGENT_HINTS.get(kind, "Score high when this agent clearly matches the user goal.")


def build_intent_agent_registry_list(
    agent_kinds: list[str],
    *,
    catalog: dict[str, Any] | None = None,
    req: object | None = None,
) -> str:
    """Numbered registry lines for the command template (one agent_kind per line)."""
    cat = catalog if catalog is not None else catalog_from_request(req)
    lines: list[str] = []
    for idx, kind in enumerate(agent_kinds, start=1):
        key = (kind or "").strip()
        if not key:
            continue
        entry = cat.get(key)
        hint = _intent_hint_for_kind(key, entry)
        lines.append(f"{idx}. {key}: {hint}")
    return "\n".join(lines) if lines else "(none)"


def build_intent_agent_rules(
    agent_kinds: list[str],
    *,
    catalog: dict[str, Any] | None = None,
    req: object | None = None,
) -> str:
    """Backward-compatible alias — registry numbered list."""
    return build_intent_agent_registry_list(agent_kinds, catalog=catalog, req=req)


def load_intent_template_body(*, ref: str = "") -> str:
    """Planning intent template — repo ``planning/`` first, bind-mount override second."""
    fallback = (
        "You are a professional planner. Score each agent in JSON.\n\n"
        "{{agent_registry_list}}\n\n{{agent_analysis_schema}}\n\n---\nUser Input\n---\n{{user_input}}"
    )
    return load_template_body(
        ref=ref or DEFAULT_INTENT_TEMPLATE_REF,
        fallback=fallback,
        extra_refs=(
            os.environ.get("OAAO_TURN_INTENT_TEMPLATE_REF", "").strip(),
            DEFAULT_INTENT_TEMPLATE_REF,
        ),
        search_dirs=(prompts_subdir("planning"), polish_templates_dir()),
    )


def render_turn_agent_intent_prompt(
    *,
    user_input: str,
    agent_kinds: list[str],
    extra_vars: dict[str, str] | None = None,
    template_ref: str = "",
    intent_payload: dict[str, Any] | None = None,
    req: object | None = None,
) -> str:
    prompt_cfg = prompt_config_from_purpose_payload(intent_payload)
    ref = command_template_ref(
        prompt_cfg,
        env_key="OAAO_TURN_INTENT_TEMPLATE_REF",
        default_ref=template_ref or DEFAULT_INTENT_TEMPLATE_REF,
    )
    body = load_intent_template_body(ref=ref)
    if not body:
        logger.warning("turn_agent_intent template missing ref=%s", ref)
        return ""
    gap_vars = {k: str(v) for k, v in (extra_vars or {}).items()}
    user_block = (user_input or "").strip()
    variables: dict[str, str] = {
        "user_input": user_block,
        "agent_analysis_schema": build_intent_analysis_schema(agent_kinds),
        "agent_registry_list": build_intent_agent_registry_list(
            agent_kinds,
            req=req,
        ),
        # Legacy placeholder — same content as agent_registry_list.
        "agent_rules": build_intent_agent_registry_list(
            agent_kinds,
            req=req,
        ),
        "planner_prompt_block": str(getattr(req, "planner_prompt_block", "") or "").strip()
        if req is not None
        else "",
    }
    variables.update(gap_vars)
    return render_template_text(body, variables)


def _coerce_score(raw: Any) -> float:
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class AgentIntentSignals:
    needs_web_search: bool
    analysis: dict[str, float]
    reasoning: dict[str, str]

    def score_for(self, agent_kind: str) -> float:
        return float(self.analysis.get(agent_kind, 0.0))


def parse_agent_intent_response(
    text: str,
    *,
    agent_kinds: list[str] | None = None,
) -> AgentIntentSignals | None:
    from oaao_orchestrator.json_utils import extract_json_object

    obj = extract_json_object(text)
    if not obj:
        return None
    analysis_raw = obj.get("analysis")
    if not isinstance(analysis_raw, dict):
        return None
    analysis: dict[str, float] = {}
    for key, val in analysis_raw.items():
        if not isinstance(key, str):
            continue
        k = key.strip()
        if not k:
            continue
        if agent_kinds and k not in agent_kinds:
            continue
        analysis[k] = _coerce_score(val)
    reasoning_raw = obj.get("reasoning")
    reasoning: dict[str, str] = {}
    if isinstance(reasoning_raw, dict):
        for key, val in reasoning_raw.items():
            if isinstance(key, str):
                reasoning[key.strip()] = str(val or "").strip()[:500]
    web = analysis.get("web_search", 0.0)
    return AgentIntentSignals(
        needs_web_search=web >= _web_threshold(),
        analysis=analysis,
        reasoning=reasoning,
    )
