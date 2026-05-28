"""Inject applied micro skill briefs into LLM context (CS-4-S7)."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.micro_skills.registry import catalog_from_request, merge_skill_payload
from oaao_orchestrator.tasks.models import RunPlan
from oaao_orchestrator.vault_rag.messages import inject_system_message


def inject_applied_micro_skills(
    messages: list[dict[str, Any]],
    *,
    req: object | None,
    plan: RunPlan | None,
) -> list[str]:
    """Prepend a system note for each planner-selected micro skill. Returns applied skill ids."""
    if plan is None or not plan.apply_skill_ids:
        return []
    catalog = {e.skill_id: e for e in catalog_from_request(req)}
    lines: list[str] = []
    applied: list[str] = []
    for sid in plan.apply_skill_ids[:8]:
        entry = catalog.get(sid)
        if entry is None:
            continue
        payload = merge_skill_payload(entry)
        brief = ""
        if isinstance(payload, dict):
            brief = str(payload.get("agent_brief") or "").strip()
        if not brief:
            brief = (entry.summary or entry.preview_markdown or "")[:1200].strip()
        if not brief:
            continue
        applied.append(sid)
        lines.append(f"### Skill `{sid}` — {entry.title}\n{brief}")
    if not lines:
        return applied
    block = (
        "The following micro skills apply to this turn. Follow their procedure and constraints "
        "when composing your reply:\n\n" + "\n\n".join(lines)
    )
    inject_system_message(messages, block)
    return applied
