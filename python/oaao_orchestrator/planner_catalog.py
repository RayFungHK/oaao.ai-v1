"""Agent / capability catalog — planner abilities hints and LLM planner guide text."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.tasks.models import AbilityHint

# Keys match ``agent_kind`` on ``RunTaskSpec`` when ``type=agent`` (fallback when request has no catalog).
AGENT_CATALOG: dict[str, AbilityHint] = {
    "vault_rag": AbilityHint(name="Knowledge base", description="Retrieve from vault sources"),
    "sandbox_code": AbilityHint(
        name="Sandbox",
        description="Write and run code in an isolated environment",
    ),
    "slides": AbilityHint(name="Slides (legacy)", description="Generate presentation decks (stub)"),
    "slide_designer": AbilityHint(
        name="Slide designer",
        description="Create and continue slide decks (outline, HTML, export)",
    ),
    "image_gen": AbilityHint(name="Images", description="Generate images from prompts"),
    "web_search": AbilityHint(
        name="Web search", description="Search the public web for live information"
    ),
    "mcp_tool": AbilityHint(name="Integrations", description="Call connected MCP tools"),
}

DEFAULT_ALLOWED_AGENTS: tuple[str, ...] = tuple(AGENT_CATALOG.keys())


def catalog_from_request(req: object | None) -> dict[str, AbilityHint]:
    """Merge PHP-registered ``agent_catalog`` payload with built-in fallbacks."""
    merged: dict[str, AbilityHint] = dict(AGENT_CATALOG)
    if req is None:
        return merged
    raw = getattr(req, "agent_catalog", None) or []
    if not isinstance(raw, list):
        return merged
    for row in raw:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("agent_kind") or "").strip()
        if not kind:
            continue
        name = str(row.get("name") or kind).strip() or kind
        desc = str(row.get("description") or "").strip()
        hint = str(row.get("planner_hint") or desc).strip()
        ask_enabled = bool(row.get("ask_enabled"))
        merged[kind] = AbilityHint(
            name=name,
            description=hint or desc or name,
            ask_enabled=ask_enabled,
            ask_hint=str(row.get("ask_hint") or "").strip(),
            ask_default_message=str(row.get("ask_default_message") or "").strip(),
            ask_title=str(row.get("ask_title") or name).strip(),
            ask_proceed_label=str(row.get("ask_proceed_label") or "").strip(),
            ask_skip_label=str(row.get("ask_skip_label") or "").strip(),
        )
    return merged


def ability_hints_for(
    kinds: list[str] | tuple[str, ...],
    *,
    catalog: dict[str, AbilityHint] | None = None,
) -> list[AbilityHint]:
    cat = catalog if catalog is not None else AGENT_CATALOG
    out: list[AbilityHint] = []
    for k in kinds:
        key = (k or "").strip()
        if not key:
            continue
        hint = cat.get(key)
        out.append(hint if hint is not None else AbilityHint(name=key, description=""))
    return out


def planner_agent_guide(
    allowed_agents: list[str],
    *,
    catalog: dict[str, AbilityHint] | None = None,
) -> str:
    """Human-readable agent guide block for LLM planner system prompts."""
    cat = catalog if catalog is not None else AGENT_CATALOG
    lines: list[str] = []
    for kind in allowed_agents:
        key = (kind or "").strip()
        if not key:
            continue
        entry = cat.get(key)
        if entry is None:
            lines.append(f"- {key}: (no description)")
            continue
        label = (entry.name or key).strip()
        desc = (entry.description or "").strip()
        line = f"- {key} ({label}): {desc}" if desc else f"- {key} ({label})"
        if getattr(entry, "ask_enabled", False):
            ask_hint = (getattr(entry, "ask_hint", None) or "").strip()
            if ask_hint:
                line += f" [ask: {ask_hint}]"
            else:
                line += (
                    " [ask: if the user did not clearly request this capability, set requires_ask=true "
                    "and ask_message explaining what you plan to do]"
                )
        lines.append(line)
    return "\n".join(lines) if lines else "(none — do not use type=agent)"


def agent_catalog_payload(
    catalog: dict[str, AbilityHint], allowed: list[str]
) -> list[dict[str, Any]]:
    """Serialize for debugging / SSE abilities (subset of allowed kinds)."""
    allow = {(a or "").strip() for a in allowed if (a or "").strip()}
    out: list[dict[str, Any]] = []
    for kind in sorted(allow):
        entry = catalog.get(kind)
        if entry is None:
            continue
        out.append(
            {
                "agent_kind": kind,
                "name": entry.name,
                "description": entry.description,
                "planner_hint": entry.description,
            }
        )
    return out
