"""LLM skill discovery — find similar skills or suggest a new one (preview markdown)."""

from __future__ import annotations

import json
import logging
from typing import Any

from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text
from oaao_orchestrator.micro_skills.markdown import skill_preview_markdown
from oaao_orchestrator.micro_skills.registry import catalog_summary_for_planner
from oaao_orchestrator.micro_skills.types import SkillEntry, SkillKind

logger = logging.getLogger(__name__)

_DISCOVER_SYSTEM = """You analyze user chat turns for reusable micro skills.
Output ONLY valid JSON (no fences):
{
  "matches": [
    {
      "skill_id": "id from catalog",
      "reason": "why this skill applies",
      "confidence": 0.0
    }
  ],
  "suggest_new": null | {
    "title": "short skill name",
    "kind": "conversation",
    "summary": "one paragraph what this skill encodes",
    "preview_markdown": "full markdown preview for user approval",
    "bind_ref": null
  }
}
Rules:
- Search the catalog first; return matches when user material fits an existing skill (especially bound_template).
- bound_template skills MUST reference an existing catalog skill_id; never invent bound_template ids.
- suggest_new only when the user articulated a repeatable procedure/layout logic with no good catalog match.
- preview_markdown must be complete enough for the user to preview before saving (headings, bullets, rules).
- Do not use keyword lists — reason from semantics."""


async def discover_skills_llm(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    user_message: str,
    catalog: list[SkillEntry],
    conversation_excerpt: str = "",
) -> dict[str, Any]:
    """Find similar skills or propose a new conversation skill with markdown preview."""
    empty: dict[str, Any] = {"matches": [], "suggest_new": None}
    if not url or not model or not (user_message or "").strip():
        return empty
    cat_block = catalog_summary_for_planner(catalog)
    user = (
        f"Skills catalog:\n{cat_block}\n\n"
        f"Recent conversation excerpt:\n{(conversation_excerpt or '')[:3000]}\n\n"
        f"Latest user message:\n{(user_message or '')[:4000]}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _DISCOVER_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        timeout_s=45.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("skill_discover_json_parse_failed")
        return empty
    valid_ids = {e.skill_id for e in catalog}
    matches_out: list[dict[str, Any]] = []
    for row in obj.get("matches") or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("skill_id") or "").strip()
        if sid not in valid_ids:
            continue
        entry = next((e for e in catalog if e.skill_id == sid), None)
        matches_out.append(
            {
                "skill_id": sid,
                "kind": entry.kind if entry else "",
                "title": entry.title if entry else sid,
                "bind_ref": entry.bind_ref if entry else None,
                "reason": str(row.get("reason") or "").strip()[:500],
                "confidence": float(row.get("confidence") or 0.0),
                "preview_markdown": (entry.preview_markdown[:4000] if entry else ""),
            }
        )
    suggest = obj.get("suggest_new")
    suggest_out = None
    if isinstance(suggest, dict) and str(suggest.get("title") or "").strip():
        kind = str(suggest.get("kind") or SkillKind.CONVERSATION).strip()
        if kind == SkillKind.BOUND_TEMPLATE:
            kind = SkillKind.CONVERSATION
        title = str(suggest.get("title") or "").strip()
        summary = str(suggest.get("summary") or "").strip()
        preview = str(suggest.get("preview_markdown") or "").strip()
        if not preview:
            preview = skill_preview_markdown(
                title=title,
                kind=kind,
                summary=summary,
                bind_ref=None,
                payload={"agent_brief": summary, "material_rules": []},
            )
        suggest_out = {
            "title": title,
            "kind": kind,
            "summary": summary,
            "preview_markdown": preview[:12000],
            "bind_ref": None,
        }
    return {"matches": matches_out, "suggest_new": suggest_out}
