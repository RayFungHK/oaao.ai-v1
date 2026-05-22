"""Render micro skill payloads as markdown previews (UI + LLM)."""

from __future__ import annotations

from typing import Any


def skill_preview_markdown(
    *,
    title: str,
    kind: str,
    summary: str = "",
    bind_ref: str | None = None,
    payload: dict[str, Any] | None = None,
) -> str:
    """Human-readable skill preview — shown when suggesting a new skill to the user."""
    lines = [f"# {title or 'Micro skill'}", ""]
    if kind:
        lines.append(f"- **Kind:** `{kind}`")
    if bind_ref:
        lines.append(f"- **Bound to:** `{bind_ref}`")
    if summary.strip():
        lines.append("")
        lines.append(summary.strip())
    if isinstance(payload, dict):
        brief = str(payload.get("agent_brief") or "").strip()
        if brief:
            lines.extend(["", "## Agent brief", "", brief])
        rules = payload.get("material_rules")
        if isinstance(rules, list) and rules:
            lines.extend(["", "## Material rules", ""])
            lines.extend(f"- {str(r).strip()}" for r in rules[:8] if str(r).strip())
        pages = payload.get("pages")
        if isinstance(pages, list) and pages:
            lines.extend(["", "## Master pages", ""])
            for p in pages[:12]:
                if not isinstance(p, dict):
                    continue
                idx = p.get("index")
                role = str(p.get("layout_role") or "").strip()
                when = str(p.get("use_when") or "").strip()[:200]
                lines.append(f"- Slide {idx} [{role}]: {when}")
    return "\n".join(lines).strip()[:12000]
