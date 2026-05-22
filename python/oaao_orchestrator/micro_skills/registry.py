"""Collect micro skills from request catalog + resolve payloads."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.micro_skills.bound_template import (
    bound_template_skill_id,
    load_bound_skill_payload,
    skill_entry_from_template_row,
)
from oaao_orchestrator.micro_skills.types import SkillEntry, SkillKind

logger = logging.getLogger(__name__)


def _row_to_entry(row: dict[str, Any]) -> SkillEntry | None:
    sid = str(row.get("skill_id") or "").strip()
    kind = str(row.get("kind") or "").strip()
    if not sid or not kind:
        return None
    preview = str(row.get("preview_markdown") or "").strip()
    if not preview:
        from oaao_orchestrator.micro_skills.markdown import skill_preview_markdown  # noqa: PLC0415

        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        preview = skill_preview_markdown(
            title=str(row.get("title") or sid),
            kind=kind,
            summary=str(row.get("summary") or ""),
            bind_ref=str(row.get("bind_ref") or "").strip() or None,
            payload=payload,
        )
    return SkillEntry(
        skill_id=sid,
        kind=kind,
        title=str(row.get("title") or sid).strip(),
        summary=str(row.get("summary") or "").strip()[:500],
        bind_ref=str(row.get("bind_ref") or "").strip() or None,
        provider_id=str(row.get("provider_id") or "").strip(),
        module_code=str(row.get("module_code") or "").strip(),
        preview_markdown=preview[:12000],
        payload=row.get("payload") if isinstance(row.get("payload"), dict) else {},
        status=str(row.get("status") or "published").strip(),
    )


def catalog_from_request(req: object | None) -> list[SkillEntry]:
    """Skills sent from PHP (bound templates + conversation/workspace rows)."""
    if req is None:
        return []
    raw = getattr(req, "skills_catalog", None) or []
    if not isinstance(raw, list):
        return []
    out: list[SkillEntry] = []
    seen: set[str] = set()
    for row in raw[:48]:
        if not isinstance(row, dict):
            continue
        entry = _row_to_entry(row)
        if entry is None or entry.skill_id in seen:
            continue
        seen.add(entry.skill_id)
        out.append(entry)
    return out


def catalog_summary_for_planner(entries: list[SkillEntry], *, max_items: int = 24) -> str:
    if not entries:
        return "(no micro skills in catalog)"
    lines: list[str] = []
    for e in entries[:max_items]:
        bind = f" bind={e.bind_ref}" if e.bind_ref else ""
        lines.append(
            f"- {e.skill_id} [{e.kind}]{bind}: {e.title} — {(e.summary or '')[:160]}"
        )
    return "\n".join(lines)


def merge_skill_payload(entry: SkillEntry) -> dict[str, Any] | None:
    """Resolve executable payload — bound templates reload from disk when needed."""
    if entry.kind == SkillKind.BOUND_TEMPLATE and entry.bind_ref:
        fresh = load_bound_skill_payload(entry.bind_ref)
        if fresh:
            return fresh
    if isinstance(entry.payload, dict) and entry.payload:
        return dict(entry.payload)
    return None


def entries_for_template_catalog_rows(rows: list[dict[str, Any]]) -> list[SkillEntry]:
    out: list[SkillEntry] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ent = skill_entry_from_template_row(row)
        if ent is not None:
            out.append(ent)
    return out


def active_bound_skill_id(template_id: str | None) -> str | None:
    tid = (template_id or "").strip()
    if not tid:
        return None
    sid = bound_template_skill_id(tid)
    return sid or None
