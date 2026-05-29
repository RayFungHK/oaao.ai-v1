"""Bubble Chat run constraints — ephemeral threads (``conversation_kind: bubble``).

Productivity post-turn hooks (calendar / todo) still run; persistent agent modes
(e.g. slide_designer planning.intent injection) are disabled.
"""

from __future__ import annotations

_PERSISTENT_AGENT_KINDS: frozenset[str] = frozenset({"slide_designer"})


def is_bubble_chat(req: object | None) -> bool:
    if req is None:
        return False
    if bool(getattr(req, "skip_persistent_agent_hooks", False)):
        return True
    # Legacy bubble flag — meant persistent agents only, not calendar/todo hooks.
    if bool(getattr(req, "skip_post_turn_agent_hooks", False)):
        return True
    return str(getattr(req, "conversation_kind", "") or "").strip().lower() == "bubble"


def should_skip_bubble_ephemeral_hooks(req: object | None) -> bool:
    """Skill suggest/upgrade and auto-title — off for bubble; productivity hooks stay on."""
    return is_bubble_chat(req)


def should_skip_persistent_agent_hooks(req: object | None) -> bool:
    return is_bubble_chat(req)


def filter_persistent_agents_from_allowed(allowed_agents: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in allowed_agents:
        kind = str(raw).strip()
        if not kind or kind in seen or kind in _PERSISTENT_AGENT_KINDS:
            continue
        seen.add(kind)
        out.append(kind)
    return out
