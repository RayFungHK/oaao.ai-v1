"""
Per-template micro skills — LLM-authored rules for mapping user material to masters.

Stored on custom template JSON as ``micro_skills``. Used at deck build time for:
- template page / layout selection (not keyword heuristics)
- typography and color constraints when filling slots
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text

logger = logging.getLogger(__name__)

MICRO_SKILLS_VERSION = 1

_MICRO_SKILLS_SCHEMA = """  "micro_skills": {
    "version": 1,
    "agent_brief": "2-4 sentences: how agents should use this template with user material",
    "pages": [
      {
        "index": 1,
        "layout_role": "cover|agenda|section|bullets|callouts|comparison|closing|generic",
        "use_when": "when user material looks like …",
        "typography_notes": "title/body font roles for this master",
        "color_notes": "which palette tokens apply to slots on this slide"
      }
    ],
    "typography": {
      "font_stack": "CSS stack from deck",
      "rules": ["3-6 short rules: CJK vs Latin, title vs body, max density"]
    },
    "colors": {
      "palette": { "bg": "#hex", "fg": "#hex", "accent": "#hex", "muted": "#hex" },
      "contrast_rules": ["2-5 rules for text on bg / accent usage"]
    },
    "material_rules": [
      "how to map bullets vs paragraphs vs metrics into slot_ids",
      "when to prefer multi-callout masters vs single body"
    ]
  }"""

_MICRO_SKILLS_GENERATE_SYSTEM = f"""You author template micro skills for slide agents. Output ONLY valid JSON (no fences):
{{
{_MICRO_SKILLS_SCHEMA}
}}
Rules:
- One pages[] row per imported template slide index (match geometry / master HTML).
- layout_role + use_when must help pick the right master for arbitrary user outline slides.
- typography/colors must align with deck_style and PPTX profile (no Arial-only for zh-Hant).
- material_rules: actionable for LLM slot fill — layout choice, font size tone, color pairing.
- Do NOT use FAQ/keyword regex lists; describe intent in natural language (use_when)."""


def micro_skills_enabled() -> bool:
    raw = (os.environ.get("OAAO_TEMPLATE_MICRO_SKILLS") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def normalize_micro_skills(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    brief = str(raw.get("agent_brief") or "").strip()
    pages = raw.get("pages")
    if not brief and not isinstance(pages, list):
        return None
    out: dict[str, Any] = {
        "version": int(raw.get("version") or MICRO_SKILLS_VERSION),
        "agent_brief": brief,
    }
    if isinstance(pages, list):
        norm_pages: list[dict[str, Any]] = []
        for row in pages[:24]:
            if not isinstance(row, dict):
                continue
            try:
                idx = int(row.get("index") or 0)
            except (TypeError, ValueError):
                idx = 0
            if idx < 1:
                continue
            norm_pages.append(
                {
                    "index": idx,
                    "layout_role": str(row.get("layout_role") or "generic").strip()[:40],
                    "use_when": str(row.get("use_when") or "").strip()[:500],
                    "typography_notes": str(row.get("typography_notes") or "").strip()[:400],
                    "color_notes": str(row.get("color_notes") or "").strip()[:400],
                }
            )
        if norm_pages:
            out["pages"] = norm_pages
    typo = raw.get("typography")
    if isinstance(typo, dict):
        rules = typo.get("rules")
        out["typography"] = {
            "font_stack": str(typo.get("font_stack") or "").strip()[:200],
            "rules": [str(x).strip() for x in rules if str(x).strip()][:8]
            if isinstance(rules, list)
            else [],
        }
    colors = raw.get("colors")
    if isinstance(colors, dict):
        pal = colors.get("palette") if isinstance(colors.get("palette"), dict) else {}
        cr = colors.get("contrast_rules")
        out["colors"] = {
            "palette": {k: str(v) for k, v in pal.items() if isinstance(v, str) and str(v).strip()},
            "contrast_rules": [str(x).strip() for x in cr if str(x).strip()][:8]
            if isinstance(cr, list)
            else [],
        }
    mr = raw.get("material_rules")
    if isinstance(mr, list):
        out["material_rules"] = [str(x).strip() for x in mr if str(x).strip()][:12]
    return out


def micro_skills_prompt_block(skills: dict[str, Any] | None) -> str:
    """Compact block for slide / slot LLM prompts."""
    if not isinstance(skills, dict):
        return ""
    lines = ["Template micro skills (follow for layout, typography, colors):"]
    brief = str(skills.get("agent_brief") or "").strip()
    if brief:
        lines.append(brief)
    typo = skills.get("typography")
    if isinstance(typo, dict):
        fs = str(typo.get("font_stack") or "").strip()
        if fs:
            lines.append(f"Typography stack: {fs}")
        for r in (typo.get("rules") or [])[:5]:
            if str(r).strip():
                lines.append(f"- {r}")
    colors = skills.get("colors")
    if isinstance(colors, dict):
        pal = colors.get("palette")
        if isinstance(pal, dict) and pal:
            lines.append(
                "Colors: "
                + ", ".join(f"{k}={pal[k]}" for k in ("bg", "fg", "accent", "muted") if pal.get(k))
            )
        for r in (colors.get("contrast_rules") or [])[:4]:
            if str(r).strip():
                lines.append(f"- {r}")
    for r in (skills.get("material_rules") or [])[:6]:
        if str(r).strip():
            lines.append(f"- {r}")
    pages = skills.get("pages")
    if isinstance(pages, list) and pages:
        lines.append("Master pages:")
        for p in pages[:14]:
            if not isinstance(p, dict):
                continue
            idx = int(p.get("index") or 0)
            role = str(p.get("layout_role") or "").strip()
            when = str(p.get("use_when") or "").strip()[:120]
            if idx > 0:
                lines.append(f"  • p{idx} [{role}]: {when}")
    return "\n".join(lines)[:6000]


def _pages_catalog_for_pick(template_pages: list[dict[str, Any]], skills: dict[str, Any]) -> str:
    skill_by_idx = {}
    for row in skills.get("pages") or []:
        if isinstance(row, dict):
            skill_by_idx[int(row.get("index") or 0)] = row
    lines: list[str] = []
    for page in sorted(template_pages, key=lambda p: int(p.get("index") or 0)):
        if not isinstance(page, dict):
            continue
        idx = int(page.get("index") or 0)
        if idx < 1:
            continue
        sk = skill_by_idx.get(idx) if isinstance(skill_by_idx.get(idx), dict) else {}
        slots: list[str] = []
        for g in page.get("geometry_slots") or []:
            if isinstance(g, dict):
                sid = str(g.get("slot_id") or "").strip()
                if sid:
                    slots.append(sid)
        lines.append(
            f"- template_page_index={idx} role={sk.get('layout_role', 'generic')} "
            f"slots=[{', '.join(slots[:8])}] use_when={str(sk.get('use_when') or '')[:160]}"
        )
    return "\n".join(lines)


async def generate_micro_skills_llm(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    template_label: str,
    deck_style: dict[str, Any] | None,
    pages: list[dict[str, Any]],
    profile: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Second-pass micro skills when analyze JSON omitted or was thin."""
    if not url or not model or not pages:
        return None
    pages_json = json.dumps(
        [
            {
                "index": p.get("index"),
                "title": p.get("title"),
                "geometry_slots": [
                    {
                        "slot_id": g.get("slot_id"),
                        "role": g.get("role"),
                        "max_chars": g.get("max_chars"),
                    }
                    for g in (p.get("geometry_slots") or [])
                    if isinstance(g, dict)
                ][:12],
            }
            for p in pages[:20]
            if isinstance(p, dict)
        ],
        ensure_ascii=False,
    )[:10000]
    style_json = json.dumps(deck_style or {}, ensure_ascii=False)[:4000]
    prof_json = json.dumps(profile or {}, ensure_ascii=False)[:6000]
    user = (
        f"Template: {template_label}\n"
        f"deck_style:\n{style_json}\n\n"
        f"pages:\n{pages_json}\n\n"
        f"PPTX profile excerpt:\n{prof_json}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _MICRO_SKILLS_GENERATE_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        timeout_s=75.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("micro_skills_json_parse_failed")
        return None
    raw = obj.get("micro_skills") if isinstance(obj.get("micro_skills"), dict) else obj
    return normalize_micro_skills(raw)


async def pick_template_page_index_llm(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    slide_spec: dict[str, Any],
    template_pages: list[dict[str, Any]],
    skills: dict[str, Any],
    used_indices: set[int],
) -> int | None:
    """LLM chooses template_page_index from micro skills + catalog (no keyword rules)."""
    if not url or not model or not micro_skills_enabled():
        return None
    available = [
        p
        for p in template_pages
        if isinstance(p, dict) and int(p.get("index") or 0) not in used_indices
    ]
    if not available:
        return None
    catalog = _pages_catalog_for_pick(template_pages, skills)
    spec_json = json.dumps(
        {
            "index": slide_spec.get("index"),
            "title": slide_spec.get("title"),
            "outline_bullets": slide_spec.get("outline_bullets"),
            "slide_teaching_brief": slide_spec.get("slide_teaching_brief"),
            "focus": slide_spec.get("focus"),
        },
        ensure_ascii=False,
    )[:3000]
    used_s = ", ".join(str(i) for i in sorted(used_indices)) or "(none)"
    system = (
        "You pick one template master page for a deck outline slide. "
        'Output ONLY JSON: {"template_page_index": <int>, "reason": "short"}\n'
        "Use template micro skills and the master catalog. "
        "Do not use keyword lists — match user material intent to use_when / layout_role."
    )
    user = (
        f"{micro_skills_prompt_block(skills)}\n\n"
        f"Already used template_page_index values: {used_s}\n\n"
        f"Available masters:\n{catalog}\n\n"
        f"Outline slide to place:\n{spec_json}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.15,
        timeout_s=35.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        return None
    try:
        pick = int(obj.get("template_page_index") or 0)
    except (TypeError, ValueError):
        return None
    valid = {int(p.get("index") or 0) for p in available}
    if pick in valid:
        return pick
    return None


def load_micro_skills_from_template(template: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(template, dict):
        return None
    return normalize_micro_skills(template.get("micro_skills"))


async def plan_template_page_picks(
    slides_spec: list[dict[str, Any]],
    template_pages: list[dict[str, Any]],
    skills: dict[str, Any],
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
) -> dict[int, int]:
    """Map outline slide index → template_page_index using micro skills + LLM."""
    from oaao_orchestrator.slide_project.template_pages import (
        _pick_template_page_for_slide,
    )

    picks: dict[int, int] = {}
    used: set[int] = set()
    sorted_spec = sorted(slides_spec, key=lambda s: int(s.get("index") or 0))
    for spec in sorted_spec:
        if not isinstance(spec, dict):
            continue
        oidx = int(spec.get("index") or 0)
        if oidx < 1:
            continue
        pick_idx = await pick_template_page_index_llm(
            url=url,
            api_key=api_key,
            model=model,
            slide_spec=spec,
            template_pages=template_pages,
            skills=skills,
            used_indices=used,
        )
        if pick_idx is None:
            page = _pick_template_page_for_slide(spec, template_pages, used)
            if isinstance(page, dict):
                pick_idx = int(page.get("index") or 0)
        if pick_idx and pick_idx > 0:
            picks[oidx] = pick_idx
            used.add(pick_idx)
    return picks
