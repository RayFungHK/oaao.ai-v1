"""LLM helpers for slide designer (SD-2 outline + per-slide markdown, SD-3 HTML)."""

from __future__ import annotations

import logging
import re
from typing import Any

from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text
from oaao_orchestrator.slide_project.rag_context import (
    resolve_vault_grounding_for_slides,
    slide_grounding_user_block,
)

logger = logging.getLogger(__name__)

_OUTLINE_SYSTEM = """You are a presentation strategist. Output ONLY valid JSON (no markdown fences):
{
  "title": "deck title",
  "slide_count": 10,
  "slides": [
    {
      "index": 1,
      "title": "short slide title",
      "script": "4-8 sentences speaker 講稿 for THIS slide only (complete thoughts, transitions)",
      "bullets": ["3-5 key on-slide points"],
      "theme": "<palette id>",
      "layout": "<layout id>"
    }
  ]
}
Rules:
- slides[].index must be 1..slide_count, unique, consecutive.
- ``script`` is REQUIRED: Manus-style narrative (what the presenter says), not a one-line label.
- ``bullets`` are short visible slide points (optional but preferred).
- theme = color palette (executive_problem=dark, platform_layers=teal cards, default=light).
- layout = REQUIRED unique composition per slide — NEVER repeat the same layout on two consecutive slides.
  * slide 1 → title_hero; last → summary; FAQ/Q&A → faq_split; case study → two_column; architecture → three_cards; tips → quote_focus; KPIs → metric_row; chapter break → section_divider.
  * Use at least 4 different layout types in a 10-slide deck.
- Match the user's language (zh-Hant if user writes Chinese).
- Never say you cannot access the user's vault, knowledge base, or private documents.
- If vault/handbook excerpts appear in the user message, treat them as the primary source — do not substitute a generic industry template.
- theme hints are palette families only — a later art-direction step locks ONE deck_theme for all slides."""

_OUTLINE_TEMPLATE_TEACHING_SYSTEM = """You plan a teaching deck on a FIXED imported slide template.
Output ONLY valid JSON (no markdown fences):
{
  "title": "deck title from handbook topic",
  "slide_count": N,
  "slides": [
    {
      "index": 1,
      "title": "short teaching slide title (user language)",
      "script": "5-10 sentences 講稿: teach this slide's handbook content; open with hook, close with bridge to next slide",
      "bullets": ["3-5 concise on-slide bullets"],
      "focus": "1-2 sentences: how to split content across PPTX slots (headline vs callouts)",
      "theme": "default"
    }
  ]
}
Rules:
- slide_count MUST equal the template slide count given in the user message.
- slides[].index must be 1..slide_count, consecutive.
- ``script`` is REQUIRED for every slide — full speaker narrative, NOT only the title.
- Use vault/handbook excerpts; do NOT reuse imported PPTX placeholder copy (Future of Business, lorem, etc.).
- Map teaching narrative in pedagogical order across slides.
- ``focus`` is for positioned template regions only (slot hints); ``script`` is what appears in deck_outline.md.
- Match the user's language (zh-Hant if user writes Chinese).
- Never say you cannot access the user's vault, knowledge base, or private documents.
- If vault/handbook excerpts appear in the user message, treat them as the primary source — do not substitute a generic industry template.
- Ignore catalog layout ids — layout is locked to the template."""


def _outline_system_prompt(*, template_teaching: bool = False) -> str:
    if template_teaching:
        return _OUTLINE_TEMPLATE_TEACHING_SYSTEM
    from oaao_orchestrator.slide_project.template_registry import (
        layout_ids_for_outline_prompt,
        theme_ids,
    )

    return (
        _OUTLINE_SYSTEM
        + f"\n- Valid layout ids: {layout_ids_for_outline_prompt()}."
        + f"\n- Valid theme ids: {'|'.join(sorted(theme_ids()))}."
    )


_STUB_MD_RE = re.compile(r"key point for slide\s*\d*|^aligned with:\s*", re.I)


def _is_stub_markdown(body: str) -> bool:
    text = (body or "").strip()
    if not text or len(text) < 40:
        return True
    if _STUB_MD_RE.search(text):  # noqa: SIM103
        return True
    return False


def _layout_markdown_recipe(layout: str) -> str:
    from oaao_orchestrator.slide_project.template_registry import (
        layout_content_recipe,
    )

    return layout_content_recipe(layout)


def _rich_fallback_markdown(
    *,
    title: str,
    deck_title: str,
    layout: str,
    idx: int,
    topic: str,
) -> str:
    topic_hint = (topic or deck_title).split("\n")[0][:120]
    if layout == "three_cards":
        return (
            f"### 核心概念\n- 與「{title}」相關的第一個實務要點\n- 對照 {topic_hint} 的具體做法\n"
            f"### 常見情境\n- 實際操作時最容易忽略的步驟\n- 建議的檢查方式\n"
            f"### 延伸應用\n- 進階延伸與下一章的銜接\n- 可立即採用的檢核項\n"
        )
    if layout == "faq_split":
        return (
            f"- 什麼時候需要關注「{title}」？\n- 最常見的錯誤是什麼？\n"
            f"- 如何判斷是否做對？\n"
            f"- 答：先對照 {topic_hint} 的步驟逐項檢查。\n"
            f"- 答：記錄例外狀況並回饋到下一輪迭代。\n"
        )
    if layout == "metric_row":
        return (
            f"- 完成度：依 {title} 的檢核表估算\n"
            f"- 效率：相較導入前的改善幅度\n"
            f"- 風險：剩餘待處理項目數量\n"
        )
    if layout == "quote_focus":
        return (
            f"「掌握 {title} 的關鍵，是把 {topic_hint} 變成可重複的流程。」\n"
            f"- 先建立最小可行步驟\n- 再逐步擴充到完整場景\n"
            f"- 每輪保留可稽核的紀錄\n- 與團隊對齊驗收標準\n"
        )
    if layout == "two_column":
        return (
            f"- 聚焦「{title}」的目標與範圍\n- 列出前置條件與必要資源\n"
            f"- 依序執行並記錄結果\n- 遇到例外時的升級路徑\n"
            f"- 完成後的複盤與改進項\n\n"
            f"右欄洞察：{topic_hint} 中與本頁最相關的實務提醒（1–2 句）。\n"
        )
    return (
        f"- 本頁重點：{title}\n"
        f"- 與整體主題「{deck_title}」的連結\n"
        f"- 具體步驟或檢核項（依 {topic_hint}）\n"
        f"- 常見誤區與避免方式\n"
        f"- 建議的下一步行動\n"
    )


_SLIDE_MD_SYSTEM = """You write ONE slide's body content as markdown (no code fences).
Rules:
- Do NOT repeat the slide title as ## heading — title is already set elsewhere.
- Use - bullets and short paragraphs; follow the layout recipe exactly.
- Write substantive teaching content in the user's language — NEVER output placeholder lines like "Key point for slide N" or "Aligned with: deck title".
- No HTML. No single-line stubs."""

_HTML_SYSTEM = """You output ONE complete HTML5 slide document for embedding in an iframe.
Rules:
- Single file: <!DOCTYPE html> ... </html>
- Self-contained CSS in <style>; no external scripts.
- Fixed canvas ONLY: html and body must be exactly 1280px wide and 720px tall with overflow:hidden (16:9). Never use min-height:100vh, width:100%, or responsive viewport scaling.
- Put all visible content inside <div class="oaao-slide-canvas"> (same 1280×720 box).
- Use flex/grid so the body region fills the frame — no empty lower third; cards/columns stretch vertically.
- Follow the locked deck visual system (palette, accent bar, typography) on every slide.
- Layout for 1280×720 only; use px/rem sizing that fits this frame; no markdown.
- Match content language. Do not wrap in ``` fences.
- Render all copy as HTML (use <strong>, <ul><li>, <h2>); never leave raw markdown (** ## -) in the document."""


_REFUSAL_TOPIC_RE = re.compile(
    r"do not have direct access|internal file system|private template library|"
    r"I cannot access|I'm unable to access",
    re.I,
)


def _user_topic(messages: list[dict[str, Any]], max_chars: int = 4000) -> str:
    parts: list[str] = []
    for msg in reversed(messages):
        role = str(msg.get("role") or "").lower()
        if role != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            chunk = content.strip()
            if _REFUSAL_TOPIC_RE.search(chunk):
                continue
            parts.append(chunk)
        if sum(len(p) for p in parts) >= max_chars:
            break
    if not parts:
        return "OAAO AI platform overview deck"
    blob = "\n\n".join(reversed(parts))
    return blob[:max_chars]


def _strip_fences(text: str) -> str:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)
    return raw.strip()


async def generate_deck_outline(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    messages: list[dict[str, Any]],
    slide_count: int = 10,
    resume_outline: str | None = None,
    template_context: str | None = None,
    template_teaching: bool = False,
    vault_grounding: str | None = None,
) -> dict[str, Any]:
    """Return {title, slide_count, slides: [{index, title, theme, focus?}, ...]}."""
    topic = _user_topic(messages)
    if resume_outline and resume_outline.strip():
        topic = f"{topic}\n\nExisting outline to extend or refine:\n{resume_outline[:6000]}"
    grounding = resolve_vault_grounding_for_slides(messages, explicit=vault_grounding)
    rag_block = slide_grounding_user_block(grounding)

    fixed_count = max(3, min(slide_count, 20))
    fallback_slides = [
        {"index": i, "title": f"Slide {i}", "theme": "default"} for i in range(1, fixed_count + 1)
    ]
    fallback = {
        "title": "Presentation",
        "slide_count": len(fallback_slides),
        "slides": fallback_slides,
    }

    if not url or not model:
        fallback["title"] = topic.split("\n")[0][:80] or fallback["title"]
        return fallback

    user_parts = [f"Topic / request:\n{topic}", f"Target slide_count: {fixed_count}."]
    if rag_block:
        user_parts.append("\n" + rag_block)
    if template_context and template_context.strip():
        user_parts.append(
            f"\nTemplate structure (fixed layouts per slide):\n{template_context[:7500]}"
        )
    user = "\n".join(user_parts)
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {
                "role": "system",
                "content": _outline_system_prompt(template_teaching=template_teaching),
            },
            {"role": "user", "content": user},
        ],
        temperature=0.35,
        timeout_s=120.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("slide_outline_json_parse_failed")
        fallback["title"] = topic.split("\n")[0][:80] or fallback["title"]
        return fallback

    from oaao_orchestrator.slide_project.outline_markdown import (
        apply_outline_fields_from_llm_row,
        merge_manus_scripts_into_slides,
        parse_manus_presentation_slides,
    )

    title = str(obj.get("title") or "Presentation").strip() or "Presentation"
    manus = parse_manus_presentation_slides(topic)
    slides_raw = obj.get("slides")
    slides: list[dict[str, Any]] = []
    if isinstance(slides_raw, list):
        for row in slides_raw:
            if not isinstance(row, dict):
                continue
            entry = apply_outline_fields_from_llm_row(row)
            if not entry:
                continue
            if template_teaching and "layout" in entry:
                del entry["layout"]
            slides.append(entry)
    slides.sort(key=lambda s: int(s["index"]))
    if not slides:
        fallback["title"] = title
        return fallback

    slides = merge_manus_scripts_into_slides(slides, manus)
    for spec in slides:
        if not str(spec.get("slide_script") or "").strip():
            idx = int(spec.get("index") or 1)
            stitle = str(spec.get("title") or f"Slide {idx}")
            spec["slide_script"] = (
                f"本頁說明「{stitle}」：承接教材與 {title}，"
                f"說明核心概念、實務做法與常見注意事項，並銜接下一主題。"
            )[:800]

    count = int(obj.get("slide_count") or len(slides) or slide_count)
    count = max(len(slides), min(max(3, count), 20))

    return {"title": title, "slide_count": count, "slides": slides}


async def generate_slide_markdown(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    slide_dir: Any = None,
    vault_grounding: str | None = None,
) -> str:
    from oaao_orchestrator.slide_project.layouts import infer_layout
    from oaao_orchestrator.slide_project.slot_content import (
        generate_slide_markdown_via_slots,
        layout_has_slots,
        slot_content_enabled,
    )

    layout = str(slide.get("layout") or "").strip() or infer_layout(slide)
    if slot_content_enabled() and layout_has_slots(layout, slide):
        from pathlib import Path

        sdir = slide_dir if isinstance(slide_dir, Path) else None
        return await generate_slide_markdown_via_slots(
            url=url,
            api_key=api_key,
            model=model,
            deck_title=deck_title,
            slide=slide,
            messages=messages,
            outline_excerpt=outline_excerpt,
            deck_style=deck_style,
            slide_dir=sdir,
            vault_grounding=vault_grounding,
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


async def _generate_slide_markdown_monolith(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    messages: list[dict[str, Any]],
    outline_excerpt: str,
    deck_style: dict[str, Any] | None = None,
    vault_grounding: str | None = None,
) -> str:
    idx = int(slide.get("index") or 1)
    title = str(slide.get("title") or f"Slide {idx}")
    theme = str(slide.get("theme") or "default")
    topic = _user_topic(messages, max_chars=2500)

    from oaao_orchestrator.slide_project.deck_style import style_prompt_block
    from oaao_orchestrator.slide_project.layouts import infer_layout

    layout = str(slide.get("layout") or "").strip() or infer_layout(slide)
    recipe = _layout_markdown_recipe(layout)
    fallback = _rich_fallback_markdown(
        title=title, deck_title=deck_title, layout=layout, idx=idx, topic=topic
    )

    if not url or not model:
        return fallback

    layout_line = f"Layout: {layout}\nContent recipe: {recipe}\n"
    style_blk = style_prompt_block(deck_style) if isinstance(deck_style, dict) else ""
    rag_block = slide_grounding_user_block(
        resolve_vault_grounding_for_slides(messages, explicit=vault_grounding),
    )
    rag_section = f"{rag_block}\n\n" if rag_block else ""
    user = (
        f"Deck: {deck_title}\nSlide {idx}: {title}\nTheme (locked): {theme}\n"
        f"{layout_line}\n{style_blk}\n\n"
        f"Write enough bullets/sections to FILL the {layout} layout (not a single short line).\n\n"
        f"{rag_section}"
        f"Outline context:\n{outline_excerpt[:3000]}\n\n"
        f"User request context:\n{topic[:2000]}"
    )
    md_system = _SLIDE_MD_SYSTEM + ("\n\n" + style_blk if style_blk else "")
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": md_system},
            {"role": "user", "content": user},
        ],
        temperature=0.4,
        timeout_s=60.0,
    )
    body = _strip_fences(text or "")
    if not body or _is_stub_markdown(body):
        logger.warning("slide_markdown_stub_fallback slide=%s", idx)
        return fallback
    return body


async def generate_slide_html(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    deck_title: str,
    slide: dict[str, Any],
    content_md: str,
    prior_errors: list[str] | None = None,
    slide_count: int = 10,
    deck_style: dict[str, Any] | None = None,
    project_dir: Any = None,
    template_asset_dir: Any = None,
) -> str:
    from oaao_orchestrator.slide_project.async_bridge import run_blocking
    from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html
    from oaao_orchestrator.slide_project.layouts import (
        layout_html_prompt,
        render_layout_slide,
    )

    idx = int(slide.get("index") or 1)
    title = str(slide.get("title") or f"Slide {idx}")
    theme = str(slide.get("theme") or "default")
    layout = str(slide.get("layout") or "").strip()

    # Deterministic layout shell (primary path) — avoids "title + dump markdown" every slide.
    if not prior_errors:
        laid_out = await run_blocking(
            render_layout_slide,
            spec=slide,
            deck_title=deck_title,
            content_md=content_md,
            slide_count=slide_count,
            deck_style=deck_style,
            project_dir=project_dir,
            template_asset_dir=template_asset_dir,
        )
        ok, _ = validate_slide_html(laid_out)
        if ok:
            return laid_out

    if not url or not model:
        return await run_blocking(
            render_layout_slide,
            spec=slide,
            deck_title=deck_title,
            content_md=content_md,
            slide_count=slide_count,
            deck_style=deck_style,
            project_dir=project_dir,
            template_asset_dir=template_asset_dir,
        )

    err_block = ""
    if prior_errors:
        err_block = "Fix these validation errors:\n" + "\n".join(f"- {e}" for e in prior_errors[:8])

    from oaao_orchestrator.slide_project.layouts import infer_layout

    layout_id = layout or infer_layout(slide, slide_count=slide_count)
    layout_hint = layout_html_prompt(layout_id, theme, deck_style)
    user = (
        f"Deck: {deck_title}\nSlide {idx}: {title}\nTheme: {theme}\n{layout_hint}\n\n"
        f"Markdown content to render:\n{content_md[:4000]}\n\n{err_block}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _HTML_SYSTEM + "\n" + layout_hint},
            {"role": "user", "content": user},
        ],
        temperature=0.35,
        timeout_s=90.0,
    )
    from oaao_orchestrator.slide_project.canvas import (
        _strip_code_fences,
        normalize_slide_html,
    )

    return normalize_slide_html(_strip_code_fences(_strip_fences(text or "")))
