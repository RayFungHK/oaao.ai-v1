"""Phase 3 — positioned PPTX master HTML shell + slot fill."""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from oaao_orchestrator.slide_project.canvas import normalize_slide_html, slide_canvas_css_block
from oaao_orchestrator.slide_project.pptx_geometry import MAX_GEOMETRY_SLOTS, pptx_master_enabled
from oaao_orchestrator.slide_project.pptx_typography import pptx_master_locale_css
from oaao_orchestrator.slide_project.template_registry import palette


def _esc(text: str) -> str:
    return html.escape((text or "").strip(), quote=True)


def _slot_content_html(raw: str) -> str:
    """Turn markdown-ish slot body into safe HTML fragment."""
    text = (raw or "").strip()
    if not text:
        return ""
    lines = text.replace("\r\n", "\n").split("\n")
    parts: list[str] = []
    bullets: list[str] = []
    paras: list[str] = []

    def flush_bullets() -> None:
        nonlocal bullets
        if bullets:
            lis = "".join(f"<li>{_esc(b)}</li>" for b in bullets[:12])
            parts.append(f"<ul class=\"oaao-pptx-slot-ul\">{lis}</ul>")
            bullets = []

    for line in lines:
        s = line.strip()
        if not s:
            flush_bullets()
            continue
        if s.startswith("###"):
            flush_bullets()
            parts.append(f"<h3 class=\"oaao-pptx-slot-h3\">{_esc(s.lstrip('#').strip())}</h3>")
            continue
        m = re.match(r"^[-*•]\s+(.+)$", s)
        if m:
            bullets.append(m.group(1).strip())
            continue
        m2 = re.match(r"^\d+\.\s+(.+)$", s)
        if m2:
            bullets.append(m2.group(1).strip())
            continue
        flush_bullets()
        paras.append(s)
    flush_bullets()
    for p in paras[:4]:
        parts.append(f"<p class=\"oaao-pptx-slot-p\">{_esc(p)}</p>")
    return "".join(parts) if parts else f"<p class=\"oaao-pptx-slot-p\">{_esc(text[:500])}</p>"


def load_font_face_css_from_asset_dir(asset_dir: Path | None) -> tuple[str, str]:
    """``(font_face_css, font_stack)`` from verified ``materials/fonts/manifest.json`` entries."""
    if asset_dir is None:
        return "", ""
    path = asset_dir / "materials" / "fonts" / "manifest.json"
    if not path.is_file():
        return "", ""
    try:
        import json

        from oaao_orchestrator.slide_project.pptx_fonts import (  # noqa: PLC0415
            build_font_face_css,
            build_font_stack_from_entries,
            verify_font_entries,
        )

        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):  # type: ignore[name-defined]
        return "", ""
    if not isinstance(raw, dict):
        return "", ""
    entries_raw = raw.get("entries")
    entries = entries_raw if isinstance(entries_raw, list) else []
    verified = verify_font_entries(asset_dir, entries)
    fallback_stack = (
        str(raw.get("font_stack") or "").strip()
        or 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    )
    if not verified:
        return "", fallback_stack
    tid = str(raw.get("template_id") or "").strip()
    return (
        build_font_face_css(tid, verified, asset_dir=asset_dir),
        build_font_stack_from_entries(verified, fallback_stack),
    )


def enrich_deck_style_with_template_fonts(
    deck_style: dict[str, Any] | None,
    template_asset_dir: Path | None,
) -> dict[str, Any]:
    """Apply template ``font_stack`` when deck typography has none yet."""
    style: dict[str, Any] = dict(deck_style) if isinstance(deck_style, dict) else {}
    typo_raw = style.get("typography")
    typo: dict[str, Any] = dict(typo_raw) if isinstance(typo_raw, dict) else {}
    if str(typo.get("font_stack") or "").strip():
        style["typography"] = typo
        return style
    _, stack = load_font_face_css_from_asset_dir(template_asset_dir)
    if stack:
        typo["font_stack"] = stack
        style["typography"] = typo
    return style


_PPTX_RUNTIME_STYLE_ID = "oaao-pptx-runtime"


def template_render_url_for_spec(spec: dict[str, Any]) -> str:
    """LibreOffice PNG preview — carries real PPTX shapes/background."""
    url = str(spec.get("template_render_url") or "").strip()
    if url and "template_render" in url:
        return url
    preview = str(spec.get("preview_url") or "").strip()
    if preview and "template_render" in preview:
        return preview
    tid = str(spec.get("template_id") or "").strip()
    tpl_page = int(spec.get("template_page_index") or spec.get("index") or 0)
    if tid and tpl_page > 0:
        return "/slide-designer/api/template_render?" + urlencode(
            {"template_id": tid, "page": tpl_page}
        )
    return ""


def _strip_pptx_decor_html(html: str) -> str:
    """Remove full-slide render PNG layer (includes baked-in template text)."""
    return re.sub(
        r'<div\s+class="oaao-pptx-decor"[^>]*>.*?</div>\s*',
        "",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )


def _has_filled_slot_values(slot_values: dict[str, str]) -> bool:
    return any(str(v).strip() for v in slot_values.values())


def _pptx_should_use_render_decor(
    slot_values: dict[str, str],
    *,
    persisted_slots: bool,
) -> bool:
    """Decor PNG duplicates template copy — skip when handbook slots are filled."""
    if persisted_slots:
        return False
    return not _has_filled_slot_values(slot_values)


def _pptx_decor_layer_html(
    spec: dict[str, Any] | None,
    *,
    template_asset_dir: Path | None = None,
) -> str:
    if not spec:
        return ""
    url = template_render_url_for_spec(spec)
    if not url:
        return ""
    slide_index = int(spec.get("index") or 0)
    if template_asset_dir is not None and _pptx_render_png_path(template_asset_dir, slide_index) is None:
        return ""
    return (
        '<div class="oaao-pptx-decor" aria-hidden="true">'
        f'<img src="{_esc(url)}" alt="" decoding="async" />'
        "</div>"
    )


def _css_slot_inner_selector(slot_id: str) -> str:
    safe = slot_id.replace("\\", "\\\\").replace('"', '\\"')
    return f'.oaao-pptx-slot[data-slot-id="{safe}"] .oaao-pptx-slot-inner'


def _slot_font_size_css(slot: dict[str, Any], slot_text: str = "") -> str:
    """Scale type to fit the PPTX text box (avoid clipped glyphs)."""
    from oaao_orchestrator.slide_project.pptx_typography import text_has_cjk  # noqa: PLC0415

    try:
        h_pct = float(slot.get("height_pct") or 10)
    except (TypeError, ValueError):
        h_pct = 10.0
    try:
        w_pct = float(slot.get("width_pct") or 20)
    except (TypeError, ValueError):
        w_pct = 20.0
    box_h_px = 720.0 * h_pct / 100.0
    box_w_px = 1280.0 * w_pct / 100.0
    # ~0.75 px per pt at 96dpi; cap so one line fits in ~82% of box height
    max_pt_fit = max(8.0, (box_h_px * 0.82) * 0.72)
    if h_pct < 6.0:
        max_pt_fit = min(max_pt_fit, 10.0)
    if h_pct < 5.0:
        max_pt_fit = min(max_pt_fit, 8.5)
    narrow = w_pct < 18.0
    if narrow:
        max_pt_fit = min(max_pt_fit, 16.0)
    body = (slot_text or "").strip()
    if text_has_cjk(body):
        char_n = len(body)
        if h_pct < 8.0 and char_n > 5:
            max_pt_fit = min(max_pt_fit, 11.0)
        if h_pct < 5.5 and char_n > 4:
            max_pt_fit = min(max_pt_fit, 9.0)
    try:
        pt = float(slot.get("font_pt") or 0)
    except (TypeError, ValueError):
        pt = 0.0
    if pt > 0:
        pt = min(pt, max_pt_fit)
    else:
        pt = min(max_pt_fit, box_h_px * 0.34 * 0.72)
    role = str(slot.get("role") or slot.get("slot_id") or "").lower()
    sid = str(slot.get("slot_id") or "")
    if role in ("title", "headline") or sid in ("title", "slot_1"):
        pt = min(pt, max_pt_fit, 30.0)
    elif role == "subtitle":
        pt = min(pt, max_pt_fit, 14.0)
    elif role == "callout" or sid.startswith("callout"):
        pt = min(pt, max_pt_fit, 18.0)
    else:
        pt = min(pt, max_pt_fit, 22.0)
    return f"{max(8.0, pt):.1f}pt"


def geometry_slots_typography_css(
    geometry_slots: list[dict[str, Any]],
    deck_style: dict[str, Any] | None = None,
    *,
    theme: str = "default",
    slot_values: dict[str, str] | None = None,
) -> str:
    """Per-region CSS from PPTX run metadata + box size (overrides generic clamps)."""
    from oaao_orchestrator.slide_project.pptx_typography import (  # noqa: PLC0415
        _is_latin_only_typeface,
        text_has_cjk,
    )

    p = palette(theme, deck_style)
    accent = p.get("accent", "#2563eb")
    muted = p.get("muted", "#64748b")
    fg = p.get("fg", "#0f172a")
    typo_raw = deck_style.get("typography") if isinstance(deck_style, dict) else {}
    default_stack = ""
    if isinstance(typo_raw, dict):
        default_stack = str(typo_raw.get("font_stack") or "").strip()

    rules: list[str] = []
    for slot in geometry_slots[:MAX_GEOMETRY_SLOTS]:
        if not isinstance(slot, dict):
            continue
        sid = str(slot.get("slot_id") or "").strip()
        if not sid:
            continue
        role = str(slot.get("role") or "").strip().lower()
        sel = _css_slot_inner_selector(sid)
        slot_text = str((slot_values or {}).get(sid) or "").strip()
        decls: list[str] = [f"font-size: {_slot_font_size_css(slot, slot_text)}"]
        try:
            fw = int(slot.get("font_weight") or 0)
        except (TypeError, ValueError):
            fw = 0
        if fw > 0:
            decls.append(f"font-weight: {fw}")
        elif role in ("title", "headline") or sid in ("title", "slot_1"):
            decls.append("font-weight: 700")
        color = str(slot.get("color") or "").strip()
        if color.startswith("#"):
            decls.append(f"color: {color}")
        elif role in ("title", "headline") or sid in ("title", "slot_1"):
            decls.append(f"color: {accent}")
        elif role == "subtitle":
            decls.append(f"color: {muted}")
        else:
            decls.append(f"color: {fg}")
        family = str(slot.get("font_family") or "").strip()
        if slot_text and text_has_cjk(slot_text):
            if default_stack:
                decls.append(f"font-family: {default_stack}")
            elif family and not _is_latin_only_typeface(family):
                stack = f'"{family}"'
                decls.append(f"font-family: {stack}")
        elif family:
            stack = f'"{family}"'
            if default_stack:
                stack = f"{stack}, {default_stack}"
            decls.append(f"font-family: {stack}")
        align = str(slot.get("text_align") or "").strip()
        if align in ("left", "center", "right", "justify"):
            decls.append(f"text-align: {align}")
        line_h = 1.2 if role in ("title", "headline") else 1.3
        decls.append(f"line-height: {line_h}")
        decls.append("overflow: hidden")
        decls.append("word-break: break-word")
        decls.append("overflow-wrap: break-word")
        rules.append(f"{sel} {{ {'; '.join(decls)}; }}")
    return "\n".join(rules)


def _pptx_runtime_stylesheet(
    geometry_slots: list[dict[str, Any]],
    *,
    theme: str,
    deck_style: dict[str, Any] | None,
    font_face_css: str = "",
    spec: dict[str, Any] | None = None,
    template_asset_dir: Path | None = None,
    use_render_decor: bool = True,
) -> str:
    """Override imported/catalog CSS: template fonts, palette, per-slot typography."""
    p = palette(theme, deck_style)
    bg = p.get("bg", "#f8fafc")
    fg = p.get("fg", "#0f172a")
    slide_index = int(spec.get("template_page_index") or spec.get("index") or 0) if isinstance(spec, dict) else 0
    render_png = _pptx_render_png_path(template_asset_dir, slide_index) if use_render_decor else None
    # Transparent canvas only when LibreOffice decor PNG is present underneath.
    has_decor = render_png is not None
    locale_css, _ = pptx_master_locale_css(deck_style)
    slot_values_raw = spec.get("_slot_values") if isinstance(spec, dict) else None
    slot_values_css = (
        {str(k): str(v) for k, v in slot_values_raw.items()}
        if isinstance(slot_values_raw, dict)
        else None
    )
    typo_css = geometry_slots_typography_css(
        geometry_slots,
        deck_style,
        theme=theme,
        slot_values=slot_values_css,
    )
    canvas_bg = "transparent" if has_decor else str(p.get("bg", "#111827"))
    parts = [
        font_face_css,
        locale_css,
        typo_css,
        f"""
.oaao-slide-canvas.oaao-layout-pptx_master {{
  display: block !important;
  flex-direction: unset !important;
  width: 1280px !important;
  height: 720px !important;
  min-height: 720px !important;
  overflow: hidden !important;
  padding: 0 !important;
  background: {canvas_bg} !important;
  color: {fg} !important;
  position: relative !important;
}}
.oaao-pptx-decor {{
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}}
.oaao-pptx-decor img {{
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}}
.oaao-pptx-slot {{
  position: absolute !important;
  z-index: 1;
  box-sizing: border-box;
  overflow: hidden;
  padding: 0.15rem 0.3rem;
}}
.oaao-pptx-slot-inner {{
  width: 100%;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}}
""",
    ]
    return "\n".join(p.strip() for p in parts if p and str(p).strip())


def _has_pptx_decor_element(html: str) -> bool:
    """True only when the decor layer markup exists (not merely CSS rules)."""
    return re.search(r'<div\s+class="oaao-pptx-decor\b', html, flags=re.IGNORECASE) is not None


def _pptx_render_png_path(template_asset_dir: Path | None, page_index: int) -> Path | None:
    if template_asset_dir is None:
        return None
    idx = max(1, int(page_index or 1))
    candidate = template_asset_dir / f"render/{idx:02d}.png"
    return candidate if candidate.is_file() else None


def _ensure_pptx_decor_in_html(
    html: str,
    spec: dict[str, Any],
    *,
    template_asset_dir: Path | None = None,
) -> str:
    if _has_pptx_decor_element(html):
        return html
    decor = _pptx_decor_layer_html(spec, template_asset_dir=template_asset_dir)
    if not decor:
        return html
    needle = '<div class="oaao-slide-canvas'
    idx = html.find(needle)
    if idx < 0:
        return html
    close = html.find(">", idx)
    if close < 0:
        return html
    return html[: close + 1] + decor + html[close + 1 :]


def _spec_with_project_template_id(
    spec: dict[str, Any],
    project_dir: Path | None,
) -> dict[str, Any]:
    if str(spec.get("template_id") or "").strip() or project_dir is None:
        return spec
    manifest_path = project_dir / "manifest.json"
    if not manifest_path.is_file():
        return spec
    try:
        import json

        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):  # type: ignore[name-defined]
        return spec
    if not isinstance(raw, dict):
        return spec
    tid = str(raw.get("template_id") or "").strip()
    if not tid:
        return spec
    return {**spec, "template_id": tid}


def inject_pptx_runtime_styles(html: str, css: str) -> str:
    """Append/replace runtime stylesheet so preview wins over stale master/catalog rules."""
    if not css.strip():
        return html
    block = f'<style id="{_PPTX_RUNTIME_STYLE_ID}">\n{css}\n</style>'
    html = re.sub(
        rf'<style\s+id="{_PPTX_RUNTIME_STYLE_ID}">.*?</style>\s*',
        "",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if "</head>" in html:
        return html.replace("</head>", f"{block}\n</head>", 1)
    return f"{block}\n{html}"


def build_master_html(
    geometry_slots: list[dict[str, Any]],
    *,
    theme: str = "default",
    deck_style: dict[str, Any] | None = None,
    title: str = "Slide",
    slot_values: dict[str, str] | None = None,
    font_face_css: str = "",
    spec: dict[str, Any] | None = None,
    template_asset_dir: Path | None = None,
) -> str:
    """Positioned master shell; optional pre-filled slot bodies."""
    p = palette(theme, deck_style)
    decor_html = _pptx_decor_layer_html(spec, template_asset_dir=template_asset_dir)
    bg = "transparent" if decor_html else p.get("bg", "#f8fafc")
    fg = p.get("fg", "#0f172a")
    accent = p.get("accent", "#2563eb")
    locale_css, html_lang = pptx_master_locale_css(deck_style)
    typo_css = geometry_slots_typography_css(geometry_slots, deck_style, theme=theme)

    slot_divs: list[str] = []
    values = slot_values or {}
    for slot in geometry_slots[:MAX_GEOMETRY_SLOTS]:
        if not isinstance(slot, dict):
            continue
        sid = str(slot.get("slot_id") or "").strip()
        if not sid:
            continue
        left = float(slot.get("left_pct") or 0)
        top = float(slot.get("top_pct") or 0)
        width = float(slot.get("width_pct") or 20)
        height = float(slot.get("height_pct") or 10)
        raw_val = str(values.get(sid) or "").strip()
        if not raw_val:
            from oaao_orchestrator.slide_project.template_slot_plan import (  # noqa: PLC0415
                is_placeholder_text,
            )

            seed = str(slot.get("text") or "").strip()
            raw_val = "" if is_placeholder_text(seed) else seed
        inner = _slot_content_html(raw_val)
        slot_divs.append(
            f'<div class="oaao-pptx-slot" data-slot-id="{_esc(sid)}" '
            f'style="left:{left}%;top:{top}%;width:{width}%;height:{height}%;">'
            f'<div class="oaao-pptx-slot-inner">{inner}</div></div>'
        )

    extra_css = "\n".join(x for x in (locale_css, typo_css) if x)
    font_css = f"\n{font_face_css}" if font_face_css else ""
    return f"""<!DOCTYPE html>
<html lang="{_esc(html_lang)}">
<head>
<meta charset="utf-8">
<title>{_esc(title)}</title>
{slide_canvas_css_block()}
<style>
{font_css}
{extra_css}
.oaao-layout-pptx_master {{
  display: block;
  box-sizing: border-box;
  width: 1280px;
  height: 720px;
  min-height: 720px;
  overflow: hidden;
  padding: 0;
  background: {bg};
  color: {fg};
  position: relative;
}}
.oaao-pptx-slot {{
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  padding: 0.35rem 0.5rem;
}}
.oaao-pptx-slot-inner {{
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-size: clamp(0.72rem, 1.35vw, 1.05rem);
  line-height: 1.35;
}}
.oaao-pptx-slot[data-slot-id="title"] .oaao-pptx-slot-inner {{
  font-size: clamp(1.1rem, 2.4vw, 1.75rem);
  font-weight: 700;
}}
.oaao-pptx-slot-ul {{
  margin: 0.2rem 0 0 1rem;
  padding: 0;
}}
.oaao-pptx-slot-ul li {{
  margin: 0.15rem 0;
}}
.oaao-pptx-slot-h3 {{
  margin: 0 0 0.25rem;
  font-size: 0.95em;
  color: {accent};
}}
</style>
</head>
<body>
<div class="oaao-slide-canvas oaao-layout-pptx_master">
{decor_html}
{"".join(slot_divs)}
</div>
</body>
</html>"""


def _clear_pptx_slot_inners(master_html: str) -> str:
    """Strip template placeholder copy so unfilled slots do not stack under new text."""
    doc = master_html
    pos = 0
    while True:
        pos = doc.find('class="oaao-pptx-slot"', pos)
        if pos < 0:
            break
        start = doc.find('<div class="oaao-pptx-slot-inner">', pos)
        if start < 0:
            pos += 1
            continue
        start += len('<div class="oaao-pptx-slot-inner">')
        end = doc.find("</div>", start)
        if end < 0:
            pos += 1
            continue
        doc = doc[:start] + doc[end:]
        pos = start
    return doc


def fill_master_html(master_html: str, slot_values: dict[str, str]) -> str:
    """Inject slot HTML into ``data-slot-id`` regions (string replace per slot)."""
    doc = _clear_pptx_slot_inners(master_html)
    for sid, raw in slot_values.items():
        slot_id = str(sid).strip()
        if not slot_id:
            continue
        inner = _slot_content_html(str(raw or ""))
        marker = f'data-slot-id="{slot_id}"'
        pos = doc.find(marker)
        if pos < 0:
            continue
        start = doc.find('<div class="oaao-pptx-slot-inner">', pos)
        if start < 0:
            continue
        start += len('<div class="oaao-pptx-slot-inner">')
        end = doc.find("</div>", start)
        if end < 0:
            continue
        doc = doc[:start] + inner + doc[end:]
    return doc


def save_template_masters(
    *,
    asset_dir: Path,
    pages: list[dict[str, Any]],
    theme: str,
    deck_style: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Write ``masters/NN.html`` and set ``master_path`` on each page row."""
    if not pptx_master_enabled():
        return pages

    masters_dir = asset_dir / "masters"
    masters_dir.mkdir(parents=True, exist_ok=True)
    out_pages: list[dict[str, Any]] = []

    font_face_css, _ = load_font_face_css_from_asset_dir(asset_dir)

    for page in pages:
        row = dict(page)
        geom = row.get("geometry_slots")
        if not isinstance(geom, list) or not geom:
            out_pages.append(row)
            continue
        idx = int(row.get("index") or 0)
        if idx < 1:
            out_pages.append(row)
            continue
        title = str(row.get("title") or f"Slide {idx}")
        style = enrich_deck_style_with_template_fonts(deck_style, asset_dir)
        runtime_css = _pptx_runtime_stylesheet(
            geom,
            theme=theme,
            deck_style=style,
            font_face_css=font_face_css,
            spec=row,
            template_asset_dir=asset_dir,
        )
        doc = inject_pptx_runtime_styles(
            build_master_html(
                geom,
                theme=theme,
                deck_style=style,
                title=title,
                font_face_css=font_face_css,
                spec=row,
                template_asset_dir=asset_dir,
            ),
            runtime_css,
        )
        rel = f"masters/{idx:02d}.html"
        path = asset_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(normalize_slide_html(doc), encoding="utf-8")
        row["master_path"] = rel
        row["layout"] = "pptx_master"
        out_pages.append(row)

    return out_pages


def slide_html_stale_vs_slots(html_path: Path, slots_path: Path) -> bool:
    """True when persisted slots.json should trigger an HTML rebuild."""
    if not slots_path.is_file():
        return False
    if not html_path.is_file():
        return True
    try:
        if slots_path.stat().st_mtime > html_path.stat().st_mtime + 0.5:
            return True
        import json

        payload = json.loads(slots_path.read_text(encoding="utf-8"))
        slots = payload.get("slots") if isinstance(payload.get("slots"), dict) else {}
        nonempty = [str(v).strip() for v in slots.values() if str(v).strip()]
        if not nonempty:
            return False
        html = html_path.read_text(encoding="utf-8")
        present = sum(1 for v in nonempty if v in html)
        return present < max(1, len(nonempty) // 2)
    except OSError:
        return False


def load_slot_values_from_slide_dir(project_dir: Path | None, slide_index: int) -> dict[str, str]:
    """Per-slot LLM output persisted as ``slides/NN/slots.json``."""
    if project_dir is None or slide_index < 1:
        return {}
    path = project_dir / f"slides/{slide_index:02d}/slots.json"
    if not path.is_file():
        return {}
    try:
        import json

        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):  # type: ignore[name-defined]
        return {}
    if not isinstance(raw, dict):
        return {}
    slots = raw.get("slots")
    if not isinstance(slots, dict):
        return {}
    return {str(k): str(v) for k, v in slots.items() if str(v).strip()}


def load_master_html_from_path(base_dir: Path, rel_path: str) -> str | None:
    rel = (rel_path or "").strip().lstrip("/")
    if not rel:
        return None
    path = base_dir / rel
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def render_pptx_master_slide(
    *,
    spec: dict[str, Any],
    deck_title: str,
    content_md: str,
    deck_style: dict[str, Any] | None = None,
    master_html: str | None = None,
    project_dir: Path | None = None,
    template_asset_dir: Path | None = None,
) -> str:
    """Render slide using positioned master + slot values."""
    spec = _spec_with_project_template_id(spec, project_dir)
    theme = str(spec.get("theme") or "default")
    if isinstance(deck_style, dict):
        theme = str(deck_style.get("deck_theme") or theme)

    from oaao_orchestrator.slide_project.template_slot_plan import is_placeholder_text  # noqa: PLC0415

    slide_index = int(spec.get("index") or 0)
    slot_values = load_slot_values_from_slide_dir(project_dir, slide_index)
    persisted_slots = bool(slot_values)
    if project_dir is not None and slide_index > 0:
        slots_path = project_dir / f"slides/{slide_index:02d}/slots.json"
        persisted_slots = slots_path.is_file() or persisted_slots

    seeds = spec.get("slot_seeds")
    if isinstance(seeds, dict) and not persisted_slots:
        for key, val in seeds.items():
            sid = str(key).strip()
            body = str(val).strip()
            if not sid or not body or is_placeholder_text(body):
                continue
            if sid not in slot_values or not str(slot_values.get(sid) or "").strip():
                slot_values[sid] = body

    if not slot_values and (content_md or "").strip():
        geom = spec.get("geometry_slots")
        if isinstance(geom, list) and len(geom) == 1:
            slot_values = {str(geom[0].get("slot_id") or "body"): content_md}
        elif isinstance(geom, list) and geom:
            slot_values.setdefault(str(geom[0].get("slot_id") or "title"), str(spec.get("title") or ""))

    geom = spec.get("geometry_slots")
    if not isinstance(geom, list) or not geom:
        from oaao_orchestrator.slide_project.layouts import render_layout_slide  # noqa: PLC0415

        return render_layout_slide(
            spec=spec,
            deck_title=deck_title,
            content_md=content_md,
            deck_style=deck_style,
        )

    if not slot_values and not persisted_slots:
        for row in geom:
            if isinstance(row, dict):
                sid = str(row.get("slot_id") or "").strip()
                txt = str(row.get("text") or "").strip()
                if sid and txt and not is_placeholder_text(txt):
                    slot_values[sid] = txt
        if not slot_values and (content_md or "").strip():
            title_sid = str(geom[0].get("slot_id") or "title") if geom else "title"
            slot_values[title_sid] = str(spec.get("title") or deck_title or "").strip()

    for row in geom:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("slot_id") or "").strip()
        if sid and sid not in slot_values:
            slot_values[sid] = ""

    from oaao_orchestrator.slide_project.slot_content import (  # noqa: PLC0415
        clamp_slot_values_to_geometry,
        normalize_pptx_slot_values,
    )

    if slot_values:
        slot_values = clamp_slot_values_to_geometry(spec, slot_values)
        slot_values = normalize_pptx_slot_values(spec, slot_values)

    style = enrich_deck_style_with_template_fonts(deck_style, template_asset_dir)
    font_face_css, _ = load_font_face_css_from_asset_dir(template_asset_dir)
    if not font_face_css and project_dir is not None:
        font_face_css, _ = load_font_face_css_from_asset_dir(project_dir)

    use_render_decor = _pptx_should_use_render_decor(
        slot_values,
        persisted_slots=persisted_slots,
    )

    spec_runtime = {**spec, "_slot_values": slot_values}
    runtime_css = _pptx_runtime_stylesheet(
        geom,
        theme=theme,
        deck_style=style,
        font_face_css=font_face_css,
        spec=spec_runtime,
        template_asset_dir=template_asset_dir,
        use_render_decor=use_render_decor,
    )

    rel = str(spec.get("master_path") or "").strip()
    master_doc = master_html
    if not master_doc and rel:
        if template_asset_dir is not None:
            master_doc = load_master_html_from_path(template_asset_dir, rel)
        if not master_doc and project_dir is not None:
            master_doc = load_master_html_from_path(project_dir, rel)

    if master_doc and slot_values:
        if not use_render_decor:
            master_doc = _strip_pptx_decor_html(master_doc)
        filled = fill_master_html(master_doc, slot_values)
        if use_render_decor:
            filled = _ensure_pptx_decor_in_html(
                filled,
                spec,
                template_asset_dir=template_asset_dir,
            )
        else:
            filled = _strip_pptx_decor_html(filled)
        return normalize_slide_html(inject_pptx_runtime_styles(filled, runtime_css))

    build_spec = spec
    if not use_render_decor and isinstance(spec, dict):
        build_spec = {
            k: v
            for k, v in spec.items()
            if k not in ("template_render_url", "preview_url", "template_render_path")
        }

    return normalize_slide_html(
        inject_pptx_runtime_styles(
            build_master_html(
                geom,
                theme=theme,
                deck_style=style,
                title=str(spec.get("title") or "Slide"),
                slot_values=slot_values or None,
                font_face_css=font_face_css,
                spec=build_spec,
                template_asset_dir=template_asset_dir,
            ),
            runtime_css,
        )
    )
