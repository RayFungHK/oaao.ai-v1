"""
Per-layout slot content generation (Phase 1).

Each catalog layout declares named slots in layouts.json. The orchestrator calls the LLM
once per slot with a small recipe, merges results into slide markdown, then
render_layout_slide() builds HTML deterministically.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from oaao_orchestrator.planner_llm import llm_chat_completion_text
from oaao_orchestrator.slide_project.llm import (
    _is_stub_markdown,
    _rich_fallback_markdown,
    _strip_fences,
    _user_topic,
)
from oaao_orchestrator.slide_project.rag_context import (
    resolve_vault_grounding_for_slides,
    slide_grounding_user_block,
)
from oaao_orchestrator.slide_project.template_registry import (
    get_layout,
    layout_component,
    resolve_layout_id,
)

logger = logging.getLogger(__name__)


def _is_placeholder_seed(text: str) -> bool:
    """Imported PPTX placeholder / vertical-letter garbage — do not treat as content to expand."""
    from oaao_orchestrator.slide_project.template_slot_plan import (
        is_placeholder_text,
    )

    return is_placeholder_text(text)


def geometry_slot_char_budget(slide: dict[str, Any], slot_id: str) -> int | None:
    """``max_chars`` from template import; else estimate from PPTX geometry sample."""
    for row in slide.get("geometry_slots") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("slot_id") or "").strip() != slot_id:
            continue
        try:
            mc = int(row.get("max_chars") or 0)
        except (TypeError, ValueError):
            mc = 0
        if mc > 0:
            return mc
        from oaao_orchestrator.slide_project.template_slot_plan import (
            estimate_max_chars_from_geometry_slot,
            is_placeholder_text,
        )

        sample = str(row.get("text") or "").strip()
        if not sample or is_placeholder_text(sample):
            return 72
        return estimate_max_chars_from_geometry_slot(row)
    return None


def _truncate_to_budget(text: str, budget: int) -> str:
    """Respect PPTX region size; CJK uses character count (no word-split mid-glyph)."""
    t = (text or "").strip()
    if budget < 1 or len(t) <= budget:
        return t
    if re.search(r"[\u4e00-\u9fff]", t):
        return t[:budget]
    cut = t[:budget]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip() or t[:budget].strip()


def _geometry_row(spec: dict[str, Any], slot_id: str) -> dict[str, Any] | None:
    for row in spec.get("geometry_slots") or []:
        if isinstance(row, dict) and str(row.get("slot_id") or "").strip() == slot_id:
            return row
    return None


def normalize_pptx_slot_values(spec: dict[str, Any], slot_values: dict[str, str]) -> dict[str, str]:
    """Unique per-region copy; headline slots use slide title; drop duplicate bodies."""
    title = str(spec.get("title") or "").strip()
    out: dict[str, str] = {}
    seen: set[str] = set()
    callout_idx = 0
    for sid, raw in slot_values.items():
        body = (raw or "").strip()
        if not body:
            continue
        row = _geometry_row(spec, sid)
        role = str((row or {}).get("role") or "").strip().lower()
        kind = str((row or {}).get("kind") or "").strip().lower()
        budget = geometry_slot_char_budget(spec, sid) or 80
        if role == "headline" or kind == "headline" or sid in ("title", "slot_1"):
            body = _truncate_to_budget(title or body, budget)
        elif sid.startswith("callout"):
            norm_key = re.sub(r"\s+", " ", body.lower())[:120]
            if norm_key in seen:
                callout_idx += 1
                body = _truncate_to_budget(
                    f"要點 {callout_idx}",
                    budget,
                )
            seen.add(re.sub(r"\s+", " ", body.lower())[:120])
        else:
            norm_key = re.sub(r"\s+", " ", body.lower())[:120]
            if norm_key in seen:
                continue
            seen.add(norm_key)
        body = _truncate_to_budget(body, budget)
        if body:
            out[sid] = body
    return out


def clamp_slot_values_to_geometry(
    spec: dict[str, Any], slot_values: dict[str, str]
) -> dict[str, str]:
    """Prevent handbook paragraphs from blowing up headline-sized PPTX regions."""
    out = dict(slot_values)
    for sid, body in list(out.items()):
        budget = geometry_slot_char_budget(spec, sid)
        if budget is None:
            continue
        text = (body or "").strip()
        if len(text) <= budget:
            out[sid] = text
            continue
        out[sid] = _truncate_to_budget(text, budget)
    return out


_PPTX_BATCH_SYSTEM = """You fill ALL positioned regions on one imported PPTX slide.
Output ONLY valid JSON (no fences):
{"slots": {"slot_id": "content", ...}}
Rules:
- Include every slot_id from the user list exactly once.
- Each region gets UNIQUE text — never repeat the same sentence in two slots.
- Respect max_chars per slot (short headline labels stay very short).
- headline / title regions: slide title or ≤max_chars label only, not the teaching brief.
- Multiple callout* regions: one distinct short bullet or phrase each (not the deck title repeated).
- Match user language (zh-Hant when user writes Chinese).
- No markdown fences, no HTML."""


_SLOT_KIND_SYSTEM: dict[str, str] = {
    "bullets": (
        "You write ONLY markdown bullet lines starting with '- '. "
        "No title, no ## headings, no code fences, no HTML."
    ),
    "paragraph": ("You write ONLY 1–2 plain sentences (no bullets, no headings, no fences)."),
    "section": (
        "You write ONE section: first line ### heading, then 2–3 lines starting with '- '. "
        "No code fences."
    ),
    "metrics": (
        "You write exactly 3 bullet lines: '- 指標名：具體說明' (value + short explanation). "
        "No headings, no fences."
    ),
}


def slot_content_enabled() -> bool:
    raw = (os.environ.get("OAAO_SLIDE_SLOT_CONTENT") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def layout_slot_defs(
    layout_id: str, slide_spec: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Return slot definitions for a layout (from JSON, PPTX geometry, or component defaults)."""
    lid = resolve_layout_id(layout_id) or (layout_id or "").strip()
    if lid == "pptx_master" and isinstance(slide_spec, dict):
        geom = slide_spec.get("geometry_slots")
        if isinstance(geom, list) and geom:
            out: list[dict[str, Any]] = []
            for row in geom:
                if not isinstance(row, dict):
                    continue
                sid = str(row.get("slot_id") or "").strip()
                if not sid:
                    continue
                text = str(row.get("text") or "")
                kind = str(row.get("kind") or "").strip()
                if not kind:
                    kind = "bullets" if text.count("\n") >= 2 or "- " in text else "paragraph"
                recipe = str(row.get("recipe") or "").strip()
                if not recipe:
                    recipe = f"Content for positioned region «{sid}» (match imported deck tone)."
                out.append(
                    {
                        "id": sid,
                        "kind": kind,
                        "label": sid.replace("_", " ").title(),
                        "recipe": recipe,
                    }
                )
            if out:
                return out
    row = get_layout(lid) if lid else None
    slots = row.get("slots") if isinstance(row, dict) else None
    if isinstance(slots, list) and slots:
        out: list[dict[str, Any]] = []
        for item in slots:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or "").strip()
            if not sid:
                continue
            out.append(
                {
                    "id": sid,
                    "kind": str(item.get("kind") or "bullets").strip() or "bullets",
                    "label": str(item.get("label") or sid).strip() or sid,
                    "recipe": str(item.get("recipe") or "").strip(),
                }
            )
        if out:
            return out
    return _default_slots_for_component(layout_component(lid or layout_id))


def layout_has_slots(layout_id: str, slide_spec: dict[str, Any] | None = None) -> bool:
    return len(layout_slot_defs(layout_id, slide_spec)) > 0


def _default_slots_for_component(component: str) -> list[dict[str, Any]]:
    defaults: dict[str, list[dict[str, Any]]] = {
        "title_content": [
            {
                "id": "lead",
                "kind": "paragraph",
                "label": "Lead",
                "recipe": "2 sentences introducing this slide topic.",
            },
            {
                "id": "bullets",
                "kind": "bullets",
                "label": "Bullets",
                "recipe": "4–5 substantive bullet points.",
            },
        ],
        "faq_split": [
            {
                "id": "questions",
                "kind": "bullets",
                "label": "Questions",
                "recipe": "4 short FAQ question bullets.",
            },
            {
                "id": "answers",
                "kind": "bullets",
                "label": "Answers",
                "recipe": "3–4 answer bullets; each line starts with '答：'.",
            },
        ],
        "three_cards": [
            {
                "id": "card_1",
                "kind": "section",
                "label": "Card 1",
                "recipe": "### 區塊一 + 2–3 bullets.",
            },
            {
                "id": "card_2",
                "kind": "section",
                "label": "Card 2",
                "recipe": "### 區塊二 + 2–3 bullets.",
            },
            {
                "id": "card_3",
                "kind": "section",
                "label": "Card 3",
                "recipe": "### 區塊三 + 2–3 bullets.",
            },
        ],
        "two_column": [
            {
                "id": "left_bullets",
                "kind": "bullets",
                "label": "Left column",
                "recipe": "5–6 bullets for the main column.",
            },
            {
                "id": "right_callout",
                "kind": "paragraph",
                "label": "Right callout",
                "recipe": "1–2 sentence insight for the right callout box.",
            },
        ],
        "title_hero": [
            {
                "id": "subtitle",
                "kind": "paragraph",
                "label": "Subtitle",
                "recipe": "One deck subtitle line under the main title.",
            },
            {
                "id": "lead",
                "kind": "paragraph",
                "label": "Lead",
                "recipe": "One opening lead sentence.",
            },
            {
                "id": "bullets",
                "kind": "bullets",
                "label": "Opening bullets",
                "recipe": "3–4 opening bullets.",
            },
        ],
        "summary": [
            {
                "id": "bullets",
                "kind": "bullets",
                "label": "Takeaways",
                "recipe": "5–6 takeaway bullets with action verbs.",
            },
        ],
        "section_divider": [
            {
                "id": "subtitle",
                "kind": "paragraph",
                "label": "Subtitle",
                "recipe": "One section subtitle line.",
            },
        ],
        "metric_row": [
            {
                "id": "metrics",
                "kind": "metrics",
                "label": "Metrics",
                "recipe": "Three KPI lines: 指標名：說明.",
            },
        ],
        "quote_focus": [
            {
                "id": "quote",
                "kind": "paragraph",
                "label": "Quote",
                "recipe": "One strong pull-quote sentence.",
            },
            {
                "id": "support_bullets",
                "kind": "bullets",
                "label": "Supporting bullets",
                "recipe": "4–5 supporting bullets.",
            },
        ],
    }
    return list(defaults.get(component, defaults["title_content"]))


def _slot_fallback(
    *,
    slot: dict[str, Any],
    title: str,
    deck_title: str,
    layout: str,
    topic: str,
) -> str:
    sid = str(slot.get("id") or "")
    kind = str(slot.get("kind") or "bullets")
    if kind == "paragraph":
        if sid == "right_callout":
            return f"{topic[:120]} 中與「{title}」最相關的實務提醒。"
        if sid == "quote":
            return f"掌握「{title}」的關鍵，是把流程變成可重複的步驟。"
        return f"本頁聚焦：{title}（{deck_title}）"
    if kind == "section":
        labels = {"card_1": "區塊一", "card_2": "區塊二", "card_3": "區塊三"}
        h = labels.get(sid, sid)
        return f"### {h}\n- 與「{title}」相關的要點\n- 可立即採用的做法"
    if kind == "metrics":
        return f"- 完成度：依「{title}」檢核\n- 效率：相較導入前的改善\n- 風險：待處理項目數"
    if sid == "answers":
        return f"- 答：先對照 {topic[:80]} 的步驟逐項檢查。\n- 答：記錄例外並納入下一輪改進。"
    if sid == "questions":
        return f"- 什麼時候需要關注「{title}」？\n- 最常見的錯誤是什麼？\n- 如何判斷是否做對？"
    # bullets default
    mono = _rich_fallback_markdown(
        title=title, deck_title=deck_title, layout=layout, idx=1, topic=topic
    )
    lines = [ln for ln in mono.split("\n") if ln.strip().startswith("-")]
    return "\n".join(lines[:6]) if lines else f"- {title}：重點一\n- 重點二\n- 重點三"


def _normalize_slot_body(kind: str, raw: str) -> str:
    text = _strip_fences(raw or "").strip()
    if not text:
        return ""
    if kind == "paragraph":
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        merged = " ".join(_strip_bullet_prefix(ln) for ln in lines[:3])
        return merged.strip()
    if kind in ("bullets", "metrics"):
        out: list[str] = []
        for ln in text.split("\n"):
            s = ln.strip()
            if not s:
                continue
            if s.startswith("```"):
                continue
            if not s.startswith("-") and not re.match(r"^\d+\.", s):
                s = f"- {s.lstrip('•* ')}"
            out.append(s)
        return "\n".join(out[:8])
    if kind == "section":
        return text
    return text


def _strip_bullet_prefix(line: str) -> str:
    return re.sub(r"^[-*•]\s+", "", (line or "").strip())


async def generate_slot_content(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    slot: dict[str, Any],
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    other_slots: dict[str, str] | None = None,
    slot_seed: str | None = None,
    vault_grounding: str | None = None,
) -> str:
    """Generate content for a single layout slot."""
    idx = int(slide.get("index") or 1)
    title = str(slide.get("title") or f"Slide {idx}")
    topic = _user_topic(messages, max_chars=2000)
    kind = str(slot.get("kind") or "bullets")
    recipe = str(slot.get("recipe") or "").strip() or f"Write {kind} for slide {title}."
    sid = str(slot.get("id") or "")

    seed = (slot_seed or "").strip()
    if not seed:
        spec_seeds = slide.get("slot_seeds")
        if isinstance(spec_seeds, dict):
            seed = str(spec_seeds.get(sid) or "").strip()
    if _is_placeholder_seed(seed):
        seed = ""

    layout = str(slide.get("layout") or "").strip()
    if layout == "pptx_master" or slide.get("geometry_slots"):
        budget = geometry_slot_char_budget(slide, sid)
        if budget:
            recipe = (
                f"{recipe} Write at most {budget} characters — short label/headline for this "
                "region (not a paragraph). Match imported template density."
            )

    fallback = _slot_fallback(
        slot=slot, title=title, deck_title=deck_title, layout=layout, topic=topic
    )
    if seed and (not url or not model):
        return _normalize_slot_body(kind, seed) or seed
    if not url or not model:
        return fallback

    from oaao_orchestrator.slide_project.deck_style import style_prompt_block

    style_blk = style_prompt_block(deck_style) if isinstance(deck_style, dict) else ""
    peer = ""
    if other_slots:
        peer_lines = [
            f"- {k}: {(v or '')[:120]}…" for k, v in other_slots.items() if v and k != sid
        ]
        if peer_lines:
            peer = (
                "Already drafted (do not repeat verbatim):\n" + "\n".join(peer_lines[:4]) + "\n\n"
            )

    system = _SLOT_KIND_SYSTEM.get(kind, _SLOT_KIND_SYSTEM["bullets"])
    if style_blk:
        system += "\n\n" + style_blk
    from oaao_orchestrator.slide_project.template_micro_skills import (
        micro_skills_prompt_block,
    )

    ms_blk = micro_skills_prompt_block(slide.get("_template_micro_skills"))
    if ms_blk:
        system += "\n\n" + ms_blk

    teaching = str(slide.get("slide_teaching_brief") or "").strip()
    seed_block = ""
    if seed and not teaching:
        seed_block = (
            "Imported template seed (expand into teaching content; keep structure, do not ignore):\n"
            f"{seed[:1200]}\n\n"
        )
    teaching_block = ""
    if teaching:
        teaching_block = (
            "Slide teaching focus (PRIMARY — split handbook content across slots; "
            "do not repeat placeholder PPTX copy):\n"
            f"{teaching[:1000]}\n\n"
        )

    body_hint = str(slide.get("template_body_hint") or "").strip()
    hint_block = ""
    if body_hint and not teaching:
        hint_block = f"Slide body from source deck:\n{body_hint[:800]}\n\n"

    rag_block = slide_grounding_user_block(
        resolve_vault_grounding_for_slides(messages, explicit=vault_grounding),
        label="Knowledge base excerpts",
    )
    rag_section = f"{rag_block}\n\n" if rag_block else ""
    user = (
        f"Deck: {deck_title}\nSlide {idx}: {title}\nLayout: {layout}\n"
        f"Slot: {sid} ({slot.get('label') or sid})\n"
        f"Task: {recipe}\n\n{rag_section}{teaching_block}{seed_block}{hint_block}{peer}"
        f"Outline:\n{outline_excerpt[:2000]}\n\n"
        f"User context:\n{topic[:1500]}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.35,
        timeout_s=45.0,
    )
    body = _normalize_slot_body(kind, _strip_fences(text or ""))
    if not body or (kind != "section" and len(body) < 12):
        logger.warning("slot_content_fallback slot=%s slide=%s", sid, idx)
        return fallback
    return body


def merge_slots_to_markdown(layout_id: str, slot_values: dict[str, str]) -> str:
    """Assemble per-slot bodies into one content.md compatible with parse_markdown_body()."""
    lid = resolve_layout_id(layout_id) or (layout_id or "").strip()
    component = layout_component(lid or layout_id)
    v = {k: (val or "").strip() for k, val in slot_values.items()}

    if component == "three_cards":
        chunks: list[str] = []
        for key, default_h in (
            ("card_1", "區塊一"),
            ("card_2", "區塊二"),
            ("card_3", "區塊三"),
        ):
            body = v.get(key, "")
            if not body:
                continue
            if body.startswith("###"):
                chunks.append(body)
            else:
                chunks.append(f"### {default_h}\n{body}")
        return "\n\n".join(chunks)

    if component == "faq_split":
        return "\n".join(x for x in (v.get("questions", ""), v.get("answers", "")) if x).strip()

    if component == "two_column":
        left = v.get("left_bullets", "")
        right = v.get("right_callout", "")
        if left and right:
            return f"{left}\n\n{right}"
        return left or right

    if component == "title_hero":
        parts = [v.get("subtitle", ""), v.get("lead", ""), v.get("bullets", "")]
        return "\n\n".join(p for p in parts if p).strip()

    if component == "quote_focus":
        quote = v.get("quote", "")
        bullets = v.get("support_bullets", "")
        if quote and not quote.startswith(("「", '"', "'")):
            stripped = quote.strip("「」\"'")
            quote = f"「{stripped}」"
        return "\n".join(x for x in (quote, bullets) if x).strip()

    if component == "metric_row":
        return v.get("metrics", "")

    if component == "section_divider":
        return v.get("subtitle", "")

    if component == "summary":
        return v.get("bullets", "")

    if component == "pptx_master" or lid == "pptx_master":
        lines = [f"- **{sid}**: {val}" for sid, val in sorted(v.items()) if val]
        body = "\n".join(lines)
        return body if len(body) >= 40 else ""

    # title_content / bullets / default
    lead = v.get("lead", "")
    bullets = v.get("bullets", "")
    if lead and bullets:
        return f"{lead}\n\n{bullets}"
    return lead or bullets


def pptx_slot_batch_enabled() -> bool:
    raw = (os.environ.get("OAAO_PPTX_SLOT_BATCH") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


async def generate_pptx_slots_batch(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    slots: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    vault_grounding: str | None = None,
) -> dict[str, str] | None:
    """One LLM call for all PPTX regions — avoids repeating teaching brief in every callout."""
    if not url or not model or len(slots) < 3:
        return None

    from oaao_orchestrator.planner_llm import _extract_json_object
    from oaao_orchestrator.slide_project.deck_style import style_prompt_block

    idx = int(slide.get("index") or 1)
    title = str(slide.get("title") or f"Slide {idx}")
    topic = _user_topic(messages, max_chars=2000)
    teaching = str(slide.get("slide_teaching_brief") or "").strip()
    meta_rows: list[dict[str, Any]] = []
    for slot in slots:
        sid = str(slot.get("id") or "").strip()
        if not sid:
            continue
        budget = geometry_slot_char_budget(slide, sid) or 72
        row = _geometry_row(slide, sid)
        meta_rows.append(
            {
                "slot_id": sid,
                "kind": slot.get("kind") or (row or {}).get("kind"),
                "role": (row or {}).get("role"),
                "max_chars": budget,
                "recipe": slot.get("recipe") or (row or {}).get("recipe"),
            }
        )
    if not meta_rows:
        return None

    style_blk = style_prompt_block(deck_style) if isinstance(deck_style, dict) else ""
    rag_block = slide_grounding_user_block(
        resolve_vault_grounding_for_slides(messages, explicit=vault_grounding),
        label="Knowledge base excerpts",
    )
    rag_section = f"{rag_block}\n\n" if rag_block else ""
    teaching_block = f"Teaching focus:\n{teaching[:1000]}\n\n" if teaching else ""
    system = _PPTX_BATCH_SYSTEM + (f"\n\n{style_blk}" if style_blk else "")
    user = (
        f"Deck: {deck_title}\nSlide {idx}: {title}\n\n"
        f"{rag_section}{teaching_block}"
        f"Regions:\n{json.dumps(meta_rows, ensure_ascii=False)[:4000]}\n\n"
        f"Outline:\n{outline_excerpt[:2000]}\n\n"
        f"User context:\n{topic[:1500]}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.35,
        timeout_s=75.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        return None
    raw_slots = obj.get("slots")
    if not isinstance(raw_slots, dict):
        return None
    values: dict[str, str] = {}
    for slot in slots:
        sid = str(slot.get("id") or "").strip()
        if not sid:
            continue
        body = str(raw_slots.get(sid) or "").strip()
        if body:
            values[sid] = _normalize_slot_body(str(slot.get("kind") or "bullets"), body)
    if len(values) < max(2, len(slots) // 3):
        return None
    return normalize_pptx_slot_values(slide, values)


async def generate_slide_markdown_via_slots(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    slide_dir: Path | None = None,
    vault_grounding: str | None = None,
) -> str:
    """Run one LLM call per slot, merge to markdown, optionally persist slots.json."""
    from oaao_orchestrator.slide_project.layouts import infer_layout

    layout = str(slide.get("layout") or "").strip() or infer_layout(slide)
    slots = layout_slot_defs(layout, slide)
    if not slots:
        from oaao_orchestrator.slide_project.llm import (
            _generate_slide_markdown_monolith,
        )

        return await _generate_slide_markdown_monolith(
            url=url,
            api_key=api_key,
            model=model,
            deck_title=deck_title,
            slide=slide,
            messages=messages,
            outline_excerpt=outline_excerpt,
            deck_style=deck_style,
            vault_grounding=vault_grounding,
        )

    values: dict[str, str] = {}
    use_pptx_batch = (
        pptx_slot_batch_enabled()
        and (layout == "pptx_master" or slide.get("geometry_slots"))
        and len(slots) >= 3
    )
    if use_pptx_batch:
        batched = await generate_pptx_slots_batch(
            url=url,
            api_key=api_key,
            model=model,
            deck_title=deck_title,
            slide={**slide, "layout": layout},
            slots=slots,
            messages=messages,
            outline_excerpt=outline_excerpt,
            deck_style=deck_style,
            vault_grounding=vault_grounding,
        )
        if isinstance(batched, dict) and batched:
            values = batched

    if not values:
        for slot in slots:
            sid = str(slot["id"])
            spec_seeds = (
                slide.get("slot_seeds") if isinstance(slide.get("slot_seeds"), dict) else {}
            )
            seed_val = (
                str(spec_seeds.get(sid) or "").strip() if isinstance(spec_seeds, dict) else ""
            )
            values[sid] = await generate_slot_content(
                url=url,
                api_key=api_key,
                model=model,
                deck_title=deck_title,
                slide={**slide, "layout": layout},
                slot=slot,
                messages=messages,
                outline_excerpt=outline_excerpt,
                deck_style=deck_style,
                other_slots=dict(values),
                slot_seed=seed_val or None,
                vault_grounding=vault_grounding,
            )

    if layout == "pptx_master" or slide.get("geometry_slots"):
        values = normalize_pptx_slot_values(slide, values)
        values = clamp_slot_values_to_geometry(slide, values)

    content_md = merge_slots_to_markdown(layout, values)
    if _is_stub_markdown(content_md):
        topic = _user_topic(messages, max_chars=2500)
        idx = int(slide.get("index") or 1)
        title = str(slide.get("title") or f"Slide {idx}")
        content_md = _rich_fallback_markdown(
            title=title, deck_title=deck_title, layout=layout, idx=idx, topic=topic
        )

    if slide_dir is not None:
        payload = {
            "layout": layout,
            "slots": values,
            "content_md": content_md,
        }
        try:
            (slide_dir / "slots.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.warning("slots_json_write_failed: %s", exc)

    return content_md


async def regenerate_slot_content(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    slot_id: str,
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    slide_dir: Path | None = None,
) -> tuple[str, dict[str, str]]:
    """
    Regenerate one slot and re-merge markdown. Loads existing slots.json when present.
    Returns (content_md, slot_values).
    """
    from oaao_orchestrator.slide_project.layouts import infer_layout

    layout = str(slide.get("layout") or "").strip() or infer_layout(slide)
    slots = layout_slot_defs(layout, slide)
    slot_map = {str(s["id"]): s for s in slots}
    if slot_id not in slot_map:
        raise ValueError(f"unknown slot_id={slot_id} for layout={layout}")

    values: dict[str, str] = {}
    if slide_dir and (slide_dir / "slots.json").is_file():
        try:
            raw = json.loads((slide_dir / "slots.json").read_text(encoding="utf-8"))
            if isinstance(raw.get("slots"), dict):
                values = {str(k): str(v) for k, v in raw["slots"].items()}
        except (OSError, json.JSONDecodeError):
            pass

    values[slot_id] = await generate_slot_content(
        url=url,
        api_key=api_key,
        model=model,
        deck_title=deck_title,
        slide={**slide, "layout": layout},
        slot=slot_map[slot_id],
        messages=messages,
        outline_excerpt=outline_excerpt,
        deck_style=deck_style,
        other_slots={k: v for k, v in values.items() if k != slot_id},
    )
    content_md = merge_slots_to_markdown(layout, values)
    if slide_dir is not None:
        payload = {"layout": layout, "slots": values, "content_md": content_md}
        (slide_dir / "slots.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (slide_dir / "content.md").write_text(content_md, encoding="utf-8")
    return content_md, values
