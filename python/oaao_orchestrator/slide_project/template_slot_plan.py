"""
PPTX geometry + optional LLM → per-slot role, size budget, and generation recipe.

Import pipeline: extract shapes → master HTML → LLM slot plan (not FAQ/keyword heuristics).
Deck runtime reads ``geometry_slots[].max_chars`` / ``recipe`` / ``kind`` from stored template JSON.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LOREM_RE = re.compile(r"lorem\s+ipsum", re.I)
_TEMPLATE_BOILERPLATE_RE = re.compile(
    r"your\s+compan|business\s+plan|more\s+info|let['\u2019]?s\s+get\s+started|"
    r"crafting\s+the|future\s+of\s+business|executive\s+summary|"
    r"mauris\s|fusce\s|placerat\s+accumsan|presentation\s+template",
    re.I,
)
_SLOT_ID_RE = re.compile(r'data-slot-id="([^"]+)"', re.I)
_FONT_FACE_RE = re.compile(r"@font-face\s*\{[^}]*\}", re.I | re.S)

_SLOT_REFINE_SYSTEM = """You refine PPTX template slot metadata using master HTML shells (1280×720).
Output ONLY valid JSON (no fences):
{
  "pages": [
    {
      "index": 1,
      "title": "short slide label",
      "slots": [
        {
          "slot_id": "title",
          "role": "headline",
          "kind": "headline",
          "max_chars": 36,
          "recipe": "what belongs in this region",
          "seed": "short sample text"
        }
      ]
    }
  ]
}
Rules:
- Every slot_id MUST appear as data-slot-id in that slide's master_html_excerpt.
- Do NOT invent slot_ids missing from the HTML.
- max_chars: from box size and typography in HTML (tiny label ≤40, headline ≤80, body ≤280).
- kind: headline | paragraph | bullets.
- recipe: one sentence for authors generating deck content later.
- seed: short non-lorem sample matching region role (not a paragraph unless body region).
- title: short slide name from title/headline slot, never lorem body text.
- One pages[] entry per slide index provided."""

_KIND_BY_ROLE: dict[str, str] = {
    "title": "headline",
    "subtitle": "headline",
    "headline": "headline",
    "body": "paragraph",
    "bullets": "bullets",
    "callout": "paragraph",
}


def is_placeholder_text(text: str) -> bool:
    t = (text or "").strip()
    if not t or _LOREM_RE.search(t) or _TEMPLATE_BOILERPLATE_RE.search(t):
        return True
    if len(t) > 180 and t.count("\n") >= 4:
        return True
    if len(t) > 72:
        return True
    if len(t) > 40 and t.count(" ") >= 6:
        return True
    return False


def estimate_max_chars_from_geometry_slot(slot: dict[str, Any]) -> int:
    """Canvas-area heuristic when LLM omits ``max_chars`` (1280×720 slide)."""
    w = float(slot.get("width_pct") or 20)
    h = float(slot.get("height_pct") or 10)
    area = max(0.5, w * h)
    sample = str(slot.get("text") or "").strip()
    if sample and not is_placeholder_text(sample):
        base = len(sample) + max(4, len(sample) // 4)
    else:
        base = 40
    if area < 8:
        cap = 48
    elif area < 20:
        cap = 120
    elif area < 35:
        cap = 220
    else:
        cap = 320
    return max(12, min(cap, base))


def _infer_slot_role_from_geometry(slot: dict[str, Any]) -> str:
    """Heuristic roles when pass-2 LLM omitted ``role`` (area + slot_id, no FAQ regex)."""
    sid = str(slot.get("slot_id") or "").strip().lower()
    try:
        w = float(slot.get("width_pct") or 0)
        h = float(slot.get("height_pct") or 0)
        top = float(slot.get("top_pct") or 50)
    except (TypeError, ValueError):
        w, h, top = 0.0, 0.0, 50.0
    area = w * h
    sample = str(slot.get("text") or "").strip()
    if sid in ("title", "headline"):
        return "headline"
    if sid == "slot_1" and area >= 8:
        return "headline"
    if "subtitle" in sid and top < 22 and len(sample) <= 80:
        return "headline"
    if sid.startswith("callout") and area < 12:
        return "callout"
    if sample.count("\n") >= 2 or "- " in sample:
        return "body"
    if area >= 18:
        return "body"
    if area < 6:
        return "callout"
    return "body"


def display_title_for_template_page(page: dict[str, Any]) -> str:
    idx = int(page.get("index") or 1)
    geom = [g for g in (page.get("geometry_slots") or []) if isinstance(g, dict)]
    for row in geom:
        if str(row.get("role") or "").strip() == "headline":
            t = str(row.get("text") or "").strip()
            if t and not is_placeholder_text(t):
                return t[:120]
    for sid in ("title", "headline", "slot_1", "subtitle"):
        for row in geom:
            if str(row.get("slot_id") or "").strip().lower() != sid:
                continue
            t = str(row.get("text") or "").strip()
            if t and not is_placeholder_text(t):
                return t[:120]
    for row in geom:
        if str(row.get("slot_id") or "").strip() != "title":
            continue
        t = str(row.get("text") or "").strip()
        if t and not is_placeholder_text(t):
            return t[:120]
    seeds = page.get("slot_seeds")
    if isinstance(seeds, dict):
        tseed = str(seeds.get("title") or "").strip()
        if tseed and not is_placeholder_text(tseed):
            return tseed[:120]
        for val in seeds.values():
            s = str(val).strip()
            if s and not is_placeholder_text(s):
                return s[:120]
    raw = str(page.get("title") or "").strip()
    if raw and not is_placeholder_text(raw):
        return raw[:120]
    return f"Slide {idx}"


def _llm_slots_by_id(llm_row: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not isinstance(llm_row, dict):
        return {}
    raw = llm_row.get("slots")
    if not isinstance(raw, list):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("slot_id") or "").strip()
        if sid:
            out[sid] = row
    return out


def _default_recipe(role: str, kind: str, max_chars: int) -> str:
    if kind == "bullets":
        return f"Up to {max_chars} chars: 3–5 bullet lines for this region ({role})."
    if kind == "headline":
        return f"Up to {max_chars} chars: one short headline ({role}), no paragraph."
    return f"Up to {max_chars} chars: plain sentences for «{role}» region."


def enrich_geometry_slots(
    geometry_slots: list[dict[str, Any]],
    llm_row: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Merge deterministic geometry + optional LLM slot plan into template-storable slots."""
    by_id = _llm_slots_by_id(llm_row)
    out: list[dict[str, Any]] = []
    for raw in geometry_slots:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        sid = str(row.get("slot_id") or "").strip()
        if not sid:
            continue
        meta = by_id.get(sid) or {}
        role = str(meta.get("role") or row.get("role") or "").strip()
        if not role or role == "body":
            inferred = _infer_slot_role_from_geometry(row)
            role = role or inferred
        role = role or "body"
        kind = str(meta.get("kind") or row.get("kind") or _KIND_BY_ROLE.get(role, "paragraph")).strip()
        try:
            max_chars = int(meta.get("max_chars") or row.get("max_chars") or 0)
        except (TypeError, ValueError):
            max_chars = 0
        if max_chars < 1:
            max_chars = estimate_max_chars_from_geometry_slot(row)
        recipe = str(meta.get("recipe") or row.get("recipe") or "").strip()
        if not recipe:
            recipe = _default_recipe(role, kind, max_chars)
        seed = str(meta.get("seed") or meta.get("sample") or row.get("text") or "").strip()
        row["role"] = role
        row["kind"] = kind
        row["max_chars"] = max_chars
        row["recipe"] = recipe[:500]
        if seed:
            row["text"] = seed[:1200]
        out.append(row)
    return out


def slot_seeds_from_geometry(geometry_slots: list[dict[str, Any]]) -> dict[str, str]:
    seeds: dict[str, str] = {}
    for row in geometry_slots:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("slot_id") or "").strip()
        if not sid:
            continue
        sample = str(row.get("text") or "").strip()
        if sample and not is_placeholder_text(sample):
            seeds[sid] = sample[:2000]
    return seeds


def merge_llm_page_plan(
    prof: dict[str, Any],
    *,
    index: int,
    total: int,
    llm_row: dict[str, Any] | None,
    layout_hints: list[str] | None = None,
) -> dict[str, Any]:
    """
    Build one ``pages[]`` row: prefer ``pptx_master`` + enriched geometry when shapes exist.
    Catalog layouts only when geometry is unavailable (legacy / non-positioned decks).
    """
    from oaao_orchestrator.slide_project.pptx_geometry import pptx_master_enabled  # noqa: PLC0415
    from oaao_orchestrator.slide_project.template_registry import (  # noqa: PLC0415
        layout_ids,
        resolve_layout_id,
    )

    geom = prof.get("geometry_slots")
    use_master = (
        pptx_master_enabled()
        and isinstance(geom, list)
        and len(geom) > 0
    )

    layout = ""
    seeds: dict[str, str] = {}
    enriched_geom: list[dict[str, Any]] = []

    if use_master:
        layout = "pptx_master"
        enriched_geom = enrich_geometry_slots(list(geom), llm_row)
        seeds = slot_seeds_from_geometry(enriched_geom)
        if isinstance(llm_row, dict):
            raw_seeds = llm_row.get("slot_seeds")
            if isinstance(raw_seeds, dict):
                for key, val in raw_seeds.items():
                    s = str(val).strip()
                    if s and not is_placeholder_text(s):
                        seeds[str(key)] = s[:2000]
    else:
        if isinstance(llm_row, dict):
            layout = str(
                llm_row.get("layout") or llm_row.get("suggested_layout") or ""
            ).strip()
        if not layout or layout == "pptx_render":
            layout = _positional_catalog_layout(index, total, layout_hints)
        layout = resolve_layout_id(layout) or "title_content"
        if isinstance(llm_row, dict):
            raw_seeds = llm_row.get("slot_seeds")
            if isinstance(raw_seeds, dict):
                seeds = {
                    str(k): str(v) for k, v in raw_seeds.items() if str(v).strip()
                }

    row: dict[str, Any] = {
        "index": index,
        "title": str(prof.get("title_guess") or f"Slide {index}").strip()[:120],
        "layout": layout,
        "slot_seeds": seeds,
        "body_hint": str(prof.get("text_sample") or "")[:600],
        "layout_source": "pptx_extract",
    }
    if isinstance(llm_row, dict) and str(llm_row.get("title") or "").strip():
        cand = str(llm_row["title"]).strip()
        if not is_placeholder_text(cand):
            row["title"] = cand[:120]

    if use_master and enriched_geom:
        row["geometry_slots"] = enriched_geom
        row["geometry_mode"] = "pptx_master"
        master = ""
        if isinstance(llm_row, dict):
            master = str(llm_row.get("master_path") or "").strip()
        if not master:
            master = f"masters/{index:02d}.html"
        row["master_path"] = master

    row["title"] = display_title_for_template_page(row)
    return row


def _positional_catalog_layout(
    index: int,
    total: int,
    layout_hints: list[str] | None = None,
) -> str:
    """No keyword regex — positional + optional LLM layout_hints when geometry missing."""
    from oaao_orchestrator.slide_project.template_registry import layout_ids  # noqa: PLC0415

    if index == 1:
        return "title_hero"
    if total > 1 and index == total:
        return "summary"
    hints = [str(h).strip() for h in (layout_hints or []) if str(h).strip()]
    hints = [h for h in hints if h in layout_ids() and h not in ("title_hero", "summary", "pptx_render")]
    if hints and index > 1:
        return hints[(index - 2) % len(hints)]
    return "title_content"


def slot_refine_from_master_enabled() -> bool:
    raw = (os.environ.get("OAAO_TEMPLATE_SLOT_REFINE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _strip_font_face_blocks(html: str) -> str:
    return _FONT_FACE_RE.sub("", html)


def compact_master_html_excerpt(html: str, *, max_chars: int = 4200) -> str:
    """Shrink master shell for LLM: drop @font-face noise, keep canvas + slot markup."""
    cleaned = _strip_font_face_blocks(html)
    slot_ids = sorted(set(_SLOT_ID_RE.findall(cleaned)))
    header = f"data_slot_ids: {', '.join(slot_ids) if slot_ids else '(none)'}\n"
    start = cleaned.find('<div class="oaao-slide-canvas')
    if start < 0:
        start = cleaned.find("<body")
    if start < 0:
        start = 0
    body = re.sub(r"\s+", " ", cleaned[start:]).strip()
    budget = max(800, max_chars - len(header))
    if len(body) > budget:
        body = body[:budget] + "…"
    return header + body


def master_html_excerpts_for_pages(
    asset_dir: Path,
    pages: list[dict[str, Any]],
) -> dict[int, str]:
    """Load ``masters/NN.html`` excerpts keyed by slide index."""
    out: dict[int, str] = {}
    for page in pages:
        if not isinstance(page, dict):
            continue
        try:
            idx = int(page.get("index") or 0)
        except (TypeError, ValueError):
            continue
        if idx < 1:
            continue
        rel = str(page.get("master_path") or f"masters/{idx:02d}.html").strip().lstrip("/")
        path = asset_dir / rel
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("master_html_read_failed path=%s err=%s", path, exc)
            continue
        out[idx] = compact_master_html_excerpt(raw)
    return out


def _profile_slide_by_index(profile: dict[str, Any]) -> dict[int, dict[str, Any]]:
    slides = profile.get("slides")
    if not isinstance(slides, list):
        return {}
    out: dict[int, dict[str, Any]] = {}
    for row in slides:
        if not isinstance(row, dict):
            continue
        try:
            idx = int(row.get("index") or 0)
        except (TypeError, ValueError):
            continue
        if idx > 0:
            out[idx] = row
    return out


def build_slot_refine_user_message(
    *,
    profile: dict[str, Any],
    pages: list[dict[str, Any]],
    master_excerpts: dict[int, str],
    label: str | None = None,
) -> str:
    prof_by_idx = _profile_slide_by_index(profile)
    parts = [
        f"Template label: {(label or '').strip() or 'Imported template'}",
        "Refine slots using geometry_slots + master_html_excerpt per slide.",
    ]
    for page in sorted(pages, key=lambda p: int(p.get("index") or 0)):
        if not isinstance(page, dict):
            continue
        idx = int(page.get("index") or 0)
        if idx < 1:
            continue
        prof = prof_by_idx.get(idx, {})
        geom = prof.get("geometry_slots") or page.get("geometry_slots") or []
        geom_trim: list[dict[str, Any]] = []
        if isinstance(geom, list):
            for g in geom:
                if not isinstance(g, dict):
                    continue
                geom_trim.append(
                    {
                        "slot_id": g.get("slot_id"),
                        "left_pct": g.get("left_pct"),
                        "top_pct": g.get("top_pct"),
                        "width_pct": g.get("width_pct"),
                        "height_pct": g.get("height_pct"),
                        "text": str(g.get("text") or "")[:120],
                    }
                )
        parts.append(
            f"\n### Slide {idx}\n"
            f"draft_title: {str(page.get('title') or '')[:120]}\n"
            f"geometry_slots: {json.dumps(geom_trim, ensure_ascii=False)[:2500]}\n"
            f"master_html_excerpt:\n{master_excerpts.get(idx, '(missing)')[:4500]}"
        )
    return "\n".join(parts)[:28000]


def apply_slot_refine_to_pages(
    profile: dict[str, Any],
    pages: list[dict[str, Any]],
    refine_pages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Re-merge pages after pass-2 LLM using stored master_path."""
    prof_by_idx = _profile_slide_by_index(profile)
    refined_by_idx: dict[int, dict[str, Any]] = {}
    for row in refine_pages:
        if not isinstance(row, dict):
            continue
        try:
            refined_by_idx[int(row.get("index") or 0)] = row
        except (TypeError, ValueError):
            continue
    total = len(pages)
    out: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        idx = int(page.get("index") or 0)
        prof = prof_by_idx.get(idx, {})
        llm_row = refined_by_idx.get(idx)
        if llm_row and prof:
            merged = merge_llm_page_plan(
                prof,
                index=idx,
                total=total,
                llm_row=llm_row,
            )
            merged["master_path"] = page.get("master_path") or merged.get("master_path")
            if page.get("master_preview_url"):
                merged["master_preview_url"] = page.get("master_preview_url")
            out.append(merged)
        else:
            out.append(dict(page))
    return out


async def refine_pages_with_master_html_llm(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    profile: dict[str, Any],
    pages: list[dict[str, Any]],
    asset_dir: Path,
    label: str | None = None,
) -> list[dict[str, Any]] | None:
    """
    Pass 2: master HTML excerpts + geometry → refined ``pages[]`` with slot budgets.
    """
    if not slot_refine_from_master_enabled():
        return None
    if not url or not model:
        return None
    excerpts = master_html_excerpts_for_pages(asset_dir, pages)
    if not excerpts:
        logger.info("slot_refine_skip no_master_html")
        return None

    from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text  # noqa: PLC0415

    user = build_slot_refine_user_message(
        profile=profile,
        pages=pages,
        master_excerpts=excerpts,
        label=label,
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _SLOT_REFINE_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        timeout_s=120.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("slot_refine_json_parse_failed")
        return None
    raw_pages = obj.get("pages")
    if not isinstance(raw_pages, list):
        logger.warning("slot_refine_missing_pages_array")
        return None
    refined = [p for p in raw_pages if isinstance(p, dict)]
    if not refined:
        return None
    merged = apply_slot_refine_to_pages(profile, pages, refined)
    logger.info("slot_refine_ok slides=%s", len(merged))
    return merged
