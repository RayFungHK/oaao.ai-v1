"""Bound template micro skills — always tied to one published template_id."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.micro_skills.types import SkillEntry, SkillKind


def bound_template_skill_id(template_id: str) -> str:
    tid = (template_id or "").strip()
    return f"bound_template:{tid}" if tid else ""


def skill_entry_from_template_row(row: dict[str, Any]) -> SkillEntry | None:
    tid = str(row.get("template_id") or "").strip()
    if not tid:
        return None
    micro = row.get("micro_skills")
    if not isinstance(micro, dict):
        micro = {}
    label = str(row.get("label") or tid).strip()
    brief = str(micro.get("agent_brief") or "").strip()
    summary = brief or f"PPTX template layout, typography, and color rules for «{label}»."
    from oaao_orchestrator.micro_skills.markdown import skill_preview_markdown  # noqa: PLC0415

    preview = skill_preview_markdown(
        title=label,
        kind=SkillKind.BOUND_TEMPLATE,
        summary=summary,
        bind_ref=tid,
        payload=micro,
    )
    return SkillEntry(
        skill_id=bound_template_skill_id(tid),
        kind=SkillKind.BOUND_TEMPLATE,
        title=label,
        summary=summary[:500],
        bind_ref=tid,
        provider_id="slide_designer.bound_template",
        module_code="oaaoai/slide-designer",
        preview_markdown=preview,
        payload=micro,
        status=str(row.get("status") or "published"),
    )


def load_bound_skill_payload(template_id: str) -> dict[str, Any] | None:
    from oaao_orchestrator.slide_project.custom_templates import load_custom_template_by_id  # noqa: PLC0415
    from oaao_orchestrator.slide_project.template_micro_skills import (  # noqa: PLC0415
        normalize_micro_skills,
    )

    tid = (template_id or "").strip()
    if not tid:
        return None
    tpl = load_custom_template_by_id(tid)
    if not isinstance(tpl, dict):
        return None
    return normalize_micro_skills(tpl.get("micro_skills"))
