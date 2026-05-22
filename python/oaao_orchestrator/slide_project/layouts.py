"""
Slide layout renderer — compositions defined in templates/layouts.json (JSON catalog).

Python implements reusable `component` renderers; new slide types are usually new JSON rows only.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

from oaao_orchestrator.slide_project.canvas import build_fallback_slide_document, normalize_slide_html
from oaao_orchestrator.slide_project.template_registry import (
    build_layout_css,
    layout_component,
    layout_ids,
    middle_rotation,
    palette as _palette,
    plan_rules,
    resolve_layout_id,
    theme_ids,
)

LAYOUT_IDS = layout_ids()


def _resolve_theme(spec: dict[str, Any], deck_style: dict[str, Any] | None) -> str:
    if isinstance(deck_style, dict):
        dt = str(deck_style.get("deck_theme") or "").strip()
        if dt in theme_ids():
            return dt
    return str(spec.get("theme") or "default").strip() or "default"


def infer_layout(spec: dict[str, Any], *, slide_count: int = 10) -> str:
    """Pick layout when outline did not set layout explicitly (fallback; prefer plan.json assignment)."""
    resolved = resolve_layout_id(str(spec.get("layout") or ""))
    if resolved:
        return resolved
    idx = int(spec.get("index") or 1)
    total = max(idx, int(slide_count or 10))
    rules = plan_rules()
    if idx == 1:
        return resolve_layout_id(str(rules.get("first_layout") or "title_hero")) or "title_hero"
    if idx == total:
        return resolve_layout_id(str(rules.get("last_layout") or "summary")) or "summary"
    if idx == 2:
        return resolve_layout_id(str(rules.get("second_layout") or "two_column")) or "two_column"
    rot = middle_rotation()
    if rot:
        return rot[(idx - 3) % len(rot)]
    return "title_content"


def _esc(text: str) -> str:
    return html.escape((text or "").strip(), quote=True)


def _strip_md_inline(text: str) -> str:
    s = (text or "").strip()
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    return s.strip()


def parse_markdown_body(content_md: str, slide_title: str) -> dict[str, Any]:
    """
    Parse per-slide markdown into structured blocks (no raw ## in HTML).
    Returns {paragraphs, bullets, sections: [{heading, bullets}]}
    """
    lines = (content_md or "").replace("\r\n", "\n").split("\n")
    title_norm = _strip_md_inline(slide_title)
    bullets: list[str] = []
    paragraphs: list[str] = []
    sections: list[dict[str, Any]] = []
    current_heading = ""
    current_bullets: list[str] = []

    def flush_section() -> None:
        nonlocal current_heading, current_bullets
        if current_heading or current_bullets:
            sections.append({"heading": current_heading, "bullets": list(current_bullets)})
        current_heading = ""
        current_bullets = []

    for line in lines:
        raw = line.strip()
        if not raw:
            continue
        if raw.startswith("```"):
            continue
        if raw.startswith("##"):
            flush_section()
            h = _strip_md_inline(raw.lstrip("#").strip())
            if h and h != title_norm:
                current_heading = h
            continue
        if raw.startswith(("#",)):
            continue
        m = re.match(r"^[-*•]\s+(.+)$", raw)
        if m:
            item = _strip_md_inline(m.group(1))
            if item:
                bullets.append(item)
                current_bullets.append(item)
            continue
        m2 = re.match(r"^\d+\.\s+(.+)$", raw)
        if m2:
            item = _strip_md_inline(m2.group(1))
            if item:
                bullets.append(item)
                current_bullets.append(item)
            continue
        para = _strip_md_inline(raw)
        if para and para != title_norm:
            paragraphs.append(para)
    flush_section()

    return {
        "paragraphs": paragraphs,
        "bullets": bullets,
        "sections": sections,
    }


_STUB_RE = re.compile(r"key point for slide\s*\d*|^aligned with:\s*", re.I)


def _clean_items(items: list[str]) -> list[str]:
    out: list[str] = []
    for x in items:
        s = (x or "").strip()
        if not s or _STUB_RE.search(s):
            continue
        out.append(s)
    return out


def _bullets_html(items: list[str], limit: int = 8) -> str:
    cleaned = _clean_items(items)
    if not cleaned:
        return ""
    lis = "".join(f"<li>{_esc(x)}</li>" for x in cleaned[:limit])
    return f"<ul>{lis}</ul>"


def _split_bullets_three(bullets: list[str]) -> list[dict[str, Any]]:
    cleaned = _clean_items(bullets)
    labels = ("重點一", "重點二", "重點三")
    if len(cleaned) < 3:
        return [{"heading": labels[i], "bullets": cleaned[i : i + 1] if i < len(cleaned) else []} for i in range(3)]
    per = max(2, len(cleaned) // 3)
    chunks: list[dict[str, Any]] = []
    for i in range(3):
        start = i * per
        end = start + per if i < 2 else len(cleaned)
        chunks.append({"heading": labels[i], "bullets": cleaned[start:end]})
    return chunks


def _render_inner(
    layout: str,
    spec: dict[str, Any],
    deck_title: str,
    parsed: dict[str, Any],
    *,
    slide_count: int = 10,
) -> str:
    title = str(spec.get("title") or "Slide")
    idx = int(spec.get("index") or 1)
    bullets = list(parsed.get("bullets") or [])
    paragraphs = list(parsed.get("paragraphs") or [])
    sections = list(parsed.get("sections") or [])
    component = layout_component(layout)

    if component == "title_hero":
        lead = paragraphs[0] if paragraphs else (bullets[0] if bullets else deck_title)
        extra = _bullets_html(bullets[:4], 4)
        return f"""
<div class="oaao-hero">
  <p class="deck">{_esc(deck_title)}</p>
  <h1>{_esc(title)}</h1>
  <p class="deck">{_esc(lead)}</p>
  {extra}
</div>"""

    if component == "summary":
        body = _bullets_html(bullets, 6) or f"<p>{_esc(paragraphs[0])}</p>" if paragraphs else ""
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill"><div class="oaao-summary-box">{body}</div></div></div>"""

    if component == "three_cards":
        cards_html = ""
        clean_secs = [
            {
                "heading": str(s.get("heading") or ""),
                "bullets": _clean_items(list(s.get("bullets") or [])),
            }
            for s in sections
            if _clean_items(list(s.get("bullets") or [])) or str(s.get("heading") or "").strip()
        ]
        chunk = clean_secs[:3] if len(clean_secs) >= 2 else _split_bullets_three(bullets)
        for i, sec in enumerate(chunk[:3]):
            h = str(sec.get("heading") or f"重點 {i + 1}").strip() or f"重點 {i + 1}"
            if _STUB_RE.search(h):
                h = f"重點 {i + 1}"
            bl = sec.get("bullets") if isinstance(sec.get("bullets"), list) else []
            cards_html += f'<div class="oaao-card"><h3>{_esc(h)}</h3>{_bullets_html(bl, 5)}</div>'
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill"><div class="oaao-cards">{cards_html}</div></div></div>"""

    if component == "two_column":
        clean_b = _clean_items(bullets)
        clean_p = _clean_items(paragraphs)
        callout = clean_p[-1] if clean_p else (clean_b[-1] if len(clean_b) >= 2 else title)
        left_b = clean_b[:-1] if len(clean_b) >= 2 and callout == clean_b[-1] else clean_b
        left = _bullets_html(left_b, 7) or _bullets_html(clean_b, 7)
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body">
  <div class="oaao-slide-body-fill">
    <div class="oaao-two-col">
      <div class="oaao-col-main">{left}</div>
      <div class="oaao-callout">{_esc(callout)}</div>
    </div>
  </div>
</div>"""

    if component == "faq_split":
        clean_p = _clean_items(paragraphs)
        qs = _clean_items(bullets[:4]) or _clean_items([str(s.get("heading") or "") for s in sections[:4]])
        ans = _clean_items(bullets[4:8])
        if sections and not ans:
            for s in sections[:4]:
                ans.extend(_clean_items(list(s.get("bullets") or [])))
        if len(qs) < 2 and clean_p:
            qs = [clean_p[0][:80], clean_p[1][:80] if len(clean_p) > 1 else title]
        while len(qs) < 2:
            qs.append(f"關於「{title}」的常見疑問")
        while len(ans) < 2:
            ans.append(f"依 {deck_title} 的建議流程處理並記錄結果。")
        q_html = _bullets_html(qs, 4)
        a_html = "".join(f'<div class="oaao-answer">{_esc(a)}</div>' for a in ans[:4])
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill"><div class="oaao-faq-grid">
  <div class="oaao-faq-q"><h3>常見問題</h3>{q_html}</div>
  <div class="oaao-faq-a">{a_html}</div>
</div></div></div>"""

    if component == "metric_row":
        metrics: list[tuple[str, str]] = []
        for b in _clean_items(bullets)[:3]:
            m = re.match(r"^(.{1,12}?)[：:]\s*(.+)$", b)
            if m:
                metrics.append((m.group(1).strip(), m.group(2).strip()))
            else:
                metrics.append((f"指標 {len(metrics) + 1}", b[:48]))
        while len(metrics) < 3:
            metrics.append((f"重點 {len(metrics) + 1}", title[:40]))
        cards = "".join(
            f'<div class="oaao-metric"><div class="val">{_esc(v)}</div><div class="lbl">{_esc(l)}</div></div>'
            for v, l in metrics[:3]
        )
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill"><div class="oaao-metrics">{cards}</div></div></div>"""

    if component == "quote_focus":
        clean_b = _clean_items(bullets)
        clean_p = _clean_items(paragraphs)
        quote = clean_p[0] if clean_p else (clean_b[0] if clean_b else title)
        side = _bullets_html(clean_b[1:6], 5)
        return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill"><div class="oaao-quote-row">
  <blockquote class="oaao-quote-block">{_esc(quote)}</blockquote>
  <div>{side}</div>
</div></div></div>"""

    if component == "section_divider":
        sub = _clean_items(paragraphs)
        subline = sub[0] if sub else deck_title
        return f"""
<div class="oaao-section-divider">
  <p class="deck">{_esc(deck_title)} · {idx} / {max(idx, slide_count)}</p>
  <h1>{_esc(title)}</h1>
  <p class="deck">{_esc(subline)}</p>
</div>"""

    # title_content / bullets
    body_parts = []
    if paragraphs:
        body_parts.append(f"<p>{_esc(paragraphs[0])}</p>")
    body_parts.append(_bullets_html(bullets, 8))
    return f"""
<div class="oaao-slide-topbar"></div>
<div class="oaao-slide-header"><h1>{_esc(title)}</h1></div>
<div class="oaao-slide-body"><div class="oaao-slide-body-fill">{"".join(body_parts)}</div></div>"""


def render_layout_slide(
    *,
    spec: dict[str, Any],
    deck_title: str,
    content_md: str,
    slide_count: int = 10,
    deck_style: dict[str, Any] | None = None,
    project_dir: Any = None,
    template_asset_dir: Any = None,
) -> str:
    """Build a full slide document from layout shell + parsed markdown."""
    theme = _resolve_theme(spec, deck_style)
    layout = resolve_layout_id(str(spec.get("layout") or "")) or infer_layout(spec, slide_count=slide_count)

    if layout == "pptx_master" or (
        isinstance(spec.get("geometry_slots"), list) and spec.get("geometry_slots")
    ):
        from oaao_orchestrator.slide_project.pptx_master import render_pptx_master_slide  # noqa: PLC0415

        pdir = project_dir if isinstance(project_dir, Path) else None
        tdir = template_asset_dir if isinstance(template_asset_dir, Path) else None
        return render_pptx_master_slide(
            spec=spec,
            deck_title=deck_title,
            content_md=content_md,
            deck_style=deck_style,
            project_dir=pdir,
            template_asset_dir=tdir,
        )
    title = str(spec.get("title") or f"Slide {spec.get('index') or 1}")
    parsed = parse_markdown_body(content_md, title)
    inner = _render_inner(layout, spec, deck_title, parsed, slide_count=slide_count)
    variant = int(spec.get("index") or 1) % 5
    doc = f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>{_esc(title)}</title>
<style>
{build_layout_css(theme, layout, deck_style)}
</style>
</head>
<body>
<div class="oaao-slide-canvas oaao-layout-{layout} oaao-variant-{variant}">
{inner}
</div>
</body>
</html>"""
    return normalize_slide_html(doc)


def layout_html_prompt(layout: str, theme: str, deck_style: dict[str, Any] | None = None) -> str:
    """Extra LLM instructions when layout renderer did not pass validation."""
    from oaao_orchestrator.slide_project.deck_style import style_prompt_block  # noqa: PLC0415

    from oaao_orchestrator.slide_project.template_registry import layout_html_prompt as _registry_prompt  # noqa: PLC0415

    style_blk = style_prompt_block(deck_style) if isinstance(deck_style, dict) else ""
    return f"{_registry_prompt(layout, theme)} {style_blk}".strip()
