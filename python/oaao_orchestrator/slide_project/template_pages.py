"""
Phase 2 — PPTX → template ``pages[]`` for custom template JSON.

Pipeline (no FAQ/keyword regex):
  1. ``extract_pptx_profile`` + ``enrich_profile_with_geometry`` (bbox %, slot_id)
  2. ``analyze_pptx_template`` LLM pass 1 → deck_style + draft slots
  3. ``save_template_masters`` → ``masters/NN.html`` per slide
  4. ``refine_pages_with_master_html_llm`` pass 2 (master HTML excerpts + geometry)
  5. ``merge_llm_page_plan`` merges extract + LLM into storable ``geometry_slots``

Deck build reads ``manifest.template_id`` → same ``geometry_slots`` + master HTML.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

from oaao_orchestrator.slide_project.template_registry import resolve_layout_id
from oaao_orchestrator.slide_project.template_slot_plan import (
    display_title_for_template_page,
    merge_llm_page_plan,
)


def template_master_html_api_path(template_id: str, page: int) -> str:
    q = {"template_id": template_id, "page": max(1, page)}
    return "/slide-designer/api/template_master_html?" + urlencode(q)


def attach_master_preview_url(row: dict[str, Any], template_id: str) -> None:
    """Set ``master_preview_url`` when positioned master HTML exists on the row."""
    master = str(row.get("master_path") or "").strip()
    if not master:
        return
    layout = str(row.get("layout") or "").strip().lower()
    suggested = str(row.get("suggested_layout") or "").strip().lower()
    if layout != "pptx_master" and suggested != "pptx_master" and not row.get("geometry_slots"):
        return
    tid = str(template_id or row.get("template_id") or "").strip()
    idx = int(row.get("index") or 0)
    if tid and idx > 0:
        row["master_preview_url"] = template_master_html_api_path(tid, idx)


def _slide_rows(profile: dict[str, Any]) -> list[dict[str, Any]]:
    slides = profile.get("slides")
    if not isinstance(slides, list):
        return []
    return [s for s in slides if isinstance(s, dict)]


def _extract_bullets(text: str) -> list[str]:
    out: list[str] = []
    for raw in (text or "").replace("\r\n", "\n").split("\n"):
        s = raw.strip()
        if not s:
            continue
        m = re.match(r"^[-*•]\s+(.+)$", s)
        if m:
            out.append(m.group(1).strip())
            continue
        m2 = re.match(r"^\d+\.\s+(.+)$", s)
        if m2:
            out.append(m2.group(1).strip())
    return out


def _paragraph_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in (text or "").replace("\r\n", "\n").split("\n"):
        s = raw.strip()
        if not s or re.match(r"^[-*•]\s+", s) or re.match(r"^\d+\.\s+", s):
            continue
        lines.append(s)
    return lines


def slot_seeds_for_layout(layout: str, prof: dict[str, Any]) -> dict[str, str]:
    """Split profile text into per-slot seed bodies for catalog layouts."""
    layout = resolve_layout_id(layout) or layout
    title = str(prof.get("title_guess") or "").strip()
    text = str(prof.get("text_sample") or "").strip()
    bullets = _extract_bullets(text)
    paragraphs = _paragraph_lines(text)

    if layout == "faq_split":
        questions = [b for b in bullets if not b.startswith("答") and not b.lower().startswith("a:")]
        answers = [b for b in bullets if b.startswith("答") or b.lower().startswith("a:")]
        if not questions and bullets:
            questions = bullets[: max(2, len(bullets) // 2)]
            answers = bullets[len(questions) :]
        if not answers and paragraphs:
            answers = [f"答：{paragraphs[0][:200]}"]
        q_md = "\n".join(f"- {q}" for q in questions[:4]) if questions else f"- 關於「{title}」？"
        a_md = "\n".join(
            (a if a.startswith("-") else f"- {a}" if a.startswith("答") else f"- 答：{a}")
            for a in answers[:4]
        ) or "- 答：請對照前述步驟逐項檢查。"
        return {"questions": q_md, "answers": a_md}

    if layout == "three_cards":
        seeds: dict[str, str] = {}
        if len(bullets) >= 6:
            per = max(2, len(bullets) // 3)
            chunks = [bullets[i : i + per] for i in range(0, len(bullets), per)][:3]
        else:
            chunks = [bullets, bullets[1:3], bullets[2:4]]
        labels = ("區塊一", "區塊二", "區塊三")
        for i, label in enumerate(labels):
            chunk = chunks[i] if i < len(chunks) else []
            body = "\n".join(f"- {c}" for c in chunk[:4]) if chunk else f"- {title} 要點"
            seeds[f"card_{i + 1}"] = f"### {label}\n{body}"
        return seeds

    if layout == "two_column":
        callout = paragraphs[-1] if paragraphs else (bullets[-1] if len(bullets) >= 2 else title)
        left = bullets[:-1] if len(bullets) >= 2 and bullets[-1] == callout else bullets
        left_md = "\n".join(f"- {b}" for b in left[:7]) or f"- {title}"
        return {"left_bullets": left_md, "right_callout": callout[:400]}

    if layout == "title_hero":
        sub = paragraphs[0] if paragraphs else title
        lead = paragraphs[1] if len(paragraphs) > 1 else (paragraphs[0] if paragraphs else "")
        bl = "\n".join(f"- {b}" for b in bullets[:4])
        out: dict[str, str] = {}
        if sub:
            out["subtitle"] = sub[:200]
        if lead and lead != sub:
            out["lead"] = lead[:300]
        if bl:
            out["bullets"] = bl
        return out

    if layout == "metric_row":
        lines = bullets[:3]
        if not lines and paragraphs:
            lines = paragraphs[:3]
        while len(lines) < 3:
            lines.append(f"指標{len(lines) + 1}：{title[:40]}")
        md = "\n".join(
            line if line.startswith("-") else f"- {line}" if "：" in line else f"- 指標：{line}"
            for line in lines[:3]
        )
        return {"metrics": md}

    if layout == "quote_focus":
        quote = paragraphs[0] if paragraphs else (bullets[0] if bullets else title)
        support = bullets[1:6] if len(bullets) > 1 else bullets
        return {
            "quote": quote[:280],
            "support_bullets": "\n".join(f"- {b}" for b in support[:5]) or f"- {title}",
        }

    if layout == "section_divider":
        sub = paragraphs[0] if paragraphs else (bullets[0] if bullets else title)
        return {"subtitle": sub[:240]}

    if layout == "summary":
        bl = bullets[:8] or [f"{title} — 重點 {i + 1}" for i in range(4)]
        return {"bullets": "\n".join(f"- {b}" for b in bl)}

    # title_content / default
    lead = paragraphs[0] if paragraphs else ""
    bl = bullets[:8]
    out: dict[str, str] = {}
    if lead:
        out["lead"] = lead[:400]
    if bl:
        out["bullets"] = "\n".join(f"- {b}" for b in bl)
    elif text:
        out["bullets"] = "\n".join(f"- {text[:120]}")
    return out


def build_page_plan_row(
    prof: dict[str, Any],
    *,
    index: int,
    total: int,
    layout_hints: list[str] | None = None,
    llm_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One template page: PPTX extract + LLM slot plan (see ``template_slot_plan``)."""
    row = merge_llm_page_plan(
        prof,
        index=index,
        total=total,
        llm_row=llm_row,
        layout_hints=layout_hints,
    )
    layout = str(row.get("layout") or "")
    if layout not in ("pptx_master", "pptx_render") and not row.get("slot_seeds"):
        seeds = slot_seeds_for_layout(layout, prof)
        row["slot_seeds"] = seeds
    return row


def build_template_pages(
    profile: dict[str, Any],
    *,
    layout_hints: list[str] | None = None,
    llm_pages: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build ``pages[]`` for custom template JSON from PPTX profile."""
    slides = _slide_rows(profile)
    if not slides:
        return []
    total = len(slides)
    llm_by_idx: dict[int, dict[str, Any]] = {}
    if isinstance(llm_pages, list):
        for row in llm_pages:
            if isinstance(row, dict):
                try:
                    llm_by_idx[int(row.get("index") or 0)] = row
                except (TypeError, ValueError):
                    continue

    pages: list[dict[str, Any]] = []
    for prof in slides:
        idx = int(prof.get("index") or len(pages) + 1)
        pages.append(
            build_page_plan_row(
                prof,
                index=idx,
                total=total,
                layout_hints=layout_hints,
                llm_row=llm_by_idx.get(idx),
            )
        )
    return pages


def merge_pages_into_preview_rows(
    preview_pages: list[dict[str, Any]],
    template_pages: list[dict[str, Any]],
    *,
    template_id: str = "",
) -> list[dict[str, Any]]:
    """Attach layout + slot_seeds to pptx_render preview page rows."""
    by_idx = {int(p.get("index") or 0): p for p in template_pages if int(p.get("index") or 0) > 0}
    out: list[dict[str, Any]] = []
    for raw in preview_pages:
        row = dict(raw)
        idx = int(row.get("index") or 0)
        plan = by_idx.get(idx)
        if plan:
            layout = str(plan.get("layout") or "").strip()
            if layout and layout != "pptx_render":
                row["layout"] = layout
                row["suggested_layout"] = layout
            seeds = plan.get("slot_seeds")
            if isinstance(seeds, dict) and seeds:
                row["slot_seeds"] = dict(seeds)
            if plan.get("body_hint"):
                row["body_hint"] = plan["body_hint"]
            geom = plan.get("geometry_slots")
            if isinstance(geom, list) and geom:
                row["geometry_slots"] = geom
                row["suggested_layout"] = "pptx_master"
            master = str(plan.get("master_path") or "").strip()
            if master:
                row["master_path"] = master
        attach_master_preview_url(row, template_id)
        out.append(row)
    return out


def build_template_outline_context(
    template_pages: list[dict[str, Any]],
    *,
    template_label: str = "",
    max_pages: int = 12,
) -> str:
    """Summarize imported template slides for handbook-teaching outline LLM."""
    sorted_pages = sorted(
        [p for p in template_pages if isinstance(p, dict)],
        key=lambda p: int(p.get("index") or 0),
    )[: max(1, min(max_pages, 20))]
    lines = [
        f"Imported template: {(template_label or '').strip() or 'custom'}",
        f"Fixed slide count: {len(sorted_pages)} (indices 1..{len(sorted_pages)}).",
        "Each slide uses pptx_master layout with positioned slots — do NOT pick catalog layouts.",
        "",
    ]
    for page in sorted_pages:
        idx = int(page.get("index") or 0)
        slots: list[str] = []
        geom = page.get("geometry_slots")
        if isinstance(geom, list):
            for g in geom[:8]:
                if not isinstance(g, dict):
                    continue
                sid = str(g.get("slot_id") or "").strip()
                role = str(g.get("role") or "").strip()
                recipe = str(g.get("recipe") or "")[:80]
                if sid:
                    slots.append(f"{sid}({role or 'body'}): {recipe or 'short label'}")
        seed_note = ""
        seeds = page.get("slot_seeds")
        if isinstance(seeds, dict) and seeds:
            seed_note = f" placeholder seeds: {', '.join(list(seeds.keys())[:6])}"
        lines.append(f"Slide {idx}: slots={'; '.join(slots) or '(geometry TBD)'}{seed_note}")
    return "\n".join(lines)[:8000]


def slides_spec_from_template_pages(
    template_pages: list[dict[str, Any]],
    slide_count: int,
    *,
    template_id: str = "",
) -> list[dict[str, Any]]:
    """
    Template-selected decks: 1:1 page plan from import (preserves ``masters/NN.html`` indices).

    Brand-only decks use this path; handbook teaching uses ``template_teaching_hybrid`` (LLM focus + template geometry).
    """
    sorted_pages = sorted(
        [p for p in template_pages if isinstance(p, dict)],
        key=lambda p: int(p.get("index") or 0),
    )
    if not sorted_pages:
        return []
    want = max(3, min(int(slide_count or 10), 20, len(sorted_pages)))
    tid = str(template_id or "").strip()
    out: list[dict[str, Any]] = []
    for page in sorted_pages[:want]:
        idx = int(page.get("index") or 0)
        if idx < 1:
            continue
        row: dict[str, Any] = {
            "index": idx,
            "title": display_title_for_template_page(page),
            "theme": "default",
            "layout_locked": True,
            "layout_source": "template",
        }
        layout = str(page.get("layout") or "").strip()
        if layout and layout != "pptx_render":
            row["layout"] = resolve_layout_id(layout) or layout
        geom = page.get("geometry_slots")
        if isinstance(geom, list) and geom:
            row["geometry_slots"] = geom
            row["layout"] = "pptx_master"
        master = str(page.get("master_path") or "").strip()
        if master:
            row["master_path"] = master
        seeds = page.get("slot_seeds")
        if isinstance(seeds, dict):
            row["slot_seeds"] = {
                str(k): str(v)[:2000] for k, v in seeds.items() if str(v).strip()
            }
        hint = str(page.get("body_hint") or "").strip()
        if hint:
            row["template_body_hint"] = hint[:600]
        if tid:
            row["template_id"] = tid
            attach_master_preview_url(row, tid)
        render_path = str(page.get("render_path") or "").strip()
        if render_path:
            row["template_render_path"] = render_path
        preview = str(page.get("preview_url") or "").strip()
        if preview and "template_render" in preview:
            row["template_render_url"] = preview
        out.append(row)
    return out


def _page_agenda_likelihood(page: dict[str, Any]) -> float:
    score = 0.0
    for row in page.get("geometry_slots") or []:
        if not isinstance(row, dict):
            continue
        blob = (
            str(row.get("text") or "")
            + " "
            + str(row.get("slot_id") or "")
        ).lower()
        if "agenda" in blob or "today agenda" in blob:
            score += 3.0
        if "callout" in blob:
            score += 0.4
        if "lorem ipsum" in blob:
            score += 2.0
        if any(k in blob for k in ("fashion", "monochrome", "creative process")):
            score += 1.5
    return score


def _slide_wants_agenda_layout(spec: dict[str, Any]) -> bool:
    title = str(spec.get("title") or "").lower()
    bullets = spec.get("outline_bullets")
    parts = [title]
    if isinstance(bullets, list):
        parts.extend(str(b) for b in bullets)
    blob = " ".join(parts).lower()
    return any(k in blob for k in ("agenda", "目錄", "大綱", "outline", "章節", "目次"))


def _slide_wants_multi_callout_layout(spec: dict[str, Any]) -> bool:
    title = str(spec.get("title") or "").lower()
    bullets = spec.get("outline_bullets")
    parts = [title]
    if isinstance(bullets, list):
        parts.extend(str(b) for b in bullets)
    blob = " ".join(parts).lower()
    return any(
        k in blob
        for k in (
            "三大",
            "支柱",
            "三個",
            "三項",
            "三種",
            "three pillar",
            "three pillars",
            "3 pillar",
        )
    )


def _pick_template_page_for_slide(
    spec: dict[str, Any],
    sorted_pages: list[dict[str, Any]],
    used_page_indices: set[int],
) -> dict[str, Any] | None:
    """Choose a template master by slide intent — not strict deck index order."""
    candidates = [
        p
        for p in sorted_pages
        if isinstance(p, dict) and int(p.get("index") or 0) not in used_page_indices
    ]
    if not candidates:
        return None

    idx = int(spec.get("index") or 1)
    wants_agenda = _slide_wants_agenda_layout(spec)
    wants_callouts = _slide_wants_multi_callout_layout(spec)
    bullets = spec.get("outline_bullets")
    bullet_n = len(bullets) if isinstance(bullets, list) else 0

    best: dict[str, Any] | None = None
    best_score = -1e9
    for page in candidates:
        geom = page.get("geometry_slots") or []
        if not isinstance(geom, list) or not geom:
            continue
        score = 0.0
        agenda = _page_agenda_likelihood(page)
        if wants_agenda:
            score += agenda * 2.5
        else:
            score -= agenda * 4.0
        callouts = sum(
            1
            for g in geom
            if isinstance(g, dict) and "callout" in str(g.get("slot_id") or "").lower()
        )
        if wants_callouts and callouts >= 3:
            score += 2.5 + min(callouts, 6) * 0.35
        elif wants_callouts and callouts < 2:
            score -= 3.0
        if bullet_n >= 3 and callouts >= 2:
            score += 1.5
        elif bullet_n <= 2 and callouts >= 4:
            score -= 2.5
        if idx == 1 and agenda < 2.0:
            score += 3.0
        elif idx == 1 and agenda >= 2.5:
            score -= 4.0
        if score > best_score:
            best_score = score
            best = page
    return best or candidates[0]


def apply_template_pages_to_slides(
    slides_spec: list[dict[str, Any]],
    template_pages: list[dict[str, Any]],
    *,
    page_picks: dict[int, int] | None = None,
    template_micro_skills: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Apply imported template page plan to deck ``slides_spec`` (outline indices).

    Sets ``layout``, ``slot_seeds``, ``layout_locked``, and optional ``template_body_hint``.
    When ``page_picks`` is set (from micro skills LLM), uses those template_page_index values.
    """
    if not slides_spec or not template_pages:
        return slides_spec

    by_idx = {
        int(p.get("index") or 0): p
        for p in template_pages
        if int(p.get("index") or 0) > 0
    }
    sorted_pages = sorted(by_idx.values(), key=lambda p: int(p.get("index") or 0))
    out: list[dict[str, Any]] = []
    used_tpl_indices: set[int] = set()
    picks = page_picks if isinstance(page_picks, dict) else {}

    for spec in sorted(slides_spec, key=lambda s: int(s.get("index") or 0)):
        row = dict(spec)
        oidx = int(row.get("index") or 0)
        page: dict[str, Any] | None = None
        pick_idx = int(picks.get(oidx) or 0) if oidx > 0 else 0
        if pick_idx > 0 and pick_idx in by_idx and pick_idx not in used_tpl_indices:
            page = by_idx[pick_idx]
        if page is None:
            page = _pick_template_page_for_slide(row, sorted_pages, used_tpl_indices)
        if not isinstance(page, dict):
            out.append(row)
            continue
        tpl_idx = int(page.get("index") or 0)
        used_tpl_indices.add(tpl_idx)
        if isinstance(template_micro_skills, dict):
            row["_template_micro_skills"] = template_micro_skills
        row["template_page_index"] = tpl_idx

        layout = str(page.get("layout") or "").strip()
        if layout and layout != "pptx_render":
            resolved = resolve_layout_id(layout) or layout
            row["layout"] = resolved
            row["layout_locked"] = True
            row["layout_source"] = "template"

        teaching = str(row.get("slide_teaching_brief") or row.get("focus") or "").strip()
        if teaching:
            row["slide_teaching_brief"] = teaching[:1200]
        else:
            hint = str(page.get("body_hint") or "").strip()
            if hint:
                row["template_body_hint"] = hint[:600]

        geom = page.get("geometry_slots")
        if isinstance(geom, list) and geom:
            row["geometry_slots"] = geom
            row["layout"] = "pptx_master"
            row["layout_locked"] = True
            row["layout_source"] = "template"
        master = str(page.get("master_path") or "").strip()
        if master:
            row["master_path"] = master
        render_path = str(page.get("render_path") or "").strip()
        if render_path:
            row["template_render_path"] = render_path
        preview = str(page.get("preview_url") or "").strip()
        if preview and "template_render" in preview:
            row["template_render_url"] = preview
        tid = str(page.get("template_id") or "").strip()
        if tid:
            row["template_id"] = tid

        out.append(row)

    from oaao_orchestrator.slide_project.layout_plan import diversify_slide_layouts  # noqa: PLC0415

    return diversify_slide_layouts(out)


def load_template_pages(template: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(template, dict):
        return []
    pages = template.get("pages")
    if isinstance(pages, list) and pages:
        return [p for p in pages if isinstance(p, dict)]
    # Fallback: preview_pages may carry slot_seeds after import
    preview = template.get("preview_pages")
    if isinstance(preview, list):
        return [p for p in preview if isinstance(p, dict) and p.get("slot_seeds")]
    return []
