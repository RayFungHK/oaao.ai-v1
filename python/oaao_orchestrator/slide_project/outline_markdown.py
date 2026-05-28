"""Rich ``deck_outline.md`` — per-slide 講稿 / bullets (Manus-style presentation MD)."""

from __future__ import annotations

import re
from typing import Any

_MANUS_SLIDE_RE = re.compile(
    r"^#\s*(\d+)\s*[-–—]\s*(.+?)\s*\n+([\s\S]*?)(?=^#\s*\d+\s*[-–—]|\Z)",
    re.MULTILINE,
)


def parse_manus_presentation_slides(text: str) -> dict[int, dict[str, str]]:
    """
    Parse Manus-style deck markdown: ``# 3 - Title`` then speaker paragraph(s).

    Returns ``{slide_index: {"title": ..., "script": ...}}``.
    """
    out: dict[int, dict[str, str]] = {}
    if not (text or "").strip():
        return out
    for m in _MANUS_SLIDE_RE.finditer(text):
        try:
            idx = int(m.group(1))
        except (TypeError, ValueError):
            continue
        if idx < 1:
            continue
        title = str(m.group(2) or "").strip()
        script = str(m.group(3) or "").strip()
        if not script:
            continue
        out[idx] = {"title": title, "script": script}
    return out


def _normalize_bullets(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()][:8]
    if isinstance(raw, str) and raw.strip():
        lines: list[str] = []
        for ln in raw.replace("\r\n", "\n").split("\n"):
            s = ln.strip()
            if not s:
                continue
            s = re.sub(r"^[-*•]\s+", "", s)
            if s:
                lines.append(s)
        return lines[:8]
    return []


def format_slide_outline_lines(spec: dict[str, Any]) -> list[str]:
    """One slide section for ``deck_outline.md``."""
    idx = int(spec.get("index") or 0)
    title = str(spec.get("title") or f"Slide {idx}").strip()
    lines: list[str] = [f"### Slide {idx}: {title}", ""]

    script = str(spec.get("slide_script") or spec.get("speaker_notes") or "").strip()
    if script:
        lines.append(script)
        lines.append("")

    bullets = _normalize_bullets(spec.get("outline_bullets"))
    if bullets:
        lines.append("**重點**")
        for b in bullets:
            lines.append(f"- {b}")
        lines.append("")

    focus = str(spec.get("slide_teaching_brief") or "").strip()
    if focus and focus != script and not script.startswith(focus[:80]):
        lines.append(f"**版面／區塊：** {focus}")
        lines.append("")

    layout = str(spec.get("layout") or "").strip()
    if layout:
        lines.append(f"`layout: {layout}`")
        lines.append("")

    lines.append("---")
    lines.append("")
    return lines


def format_deck_outline_markdown(
    deck_title: str,
    slides_spec: list[dict[str, Any]],
) -> str:
    """Full deck outline document with per-slide 講稿 (not title-only bullets)."""
    title = (deck_title or "Presentation").strip()
    lines = [f"# {title}", "", "## Outline", ""]
    for spec in sorted(slides_spec, key=lambda s: int(s.get("index") or 0)):
        if not isinstance(spec, dict):
            continue
        lines.extend(format_slide_outline_lines(spec))
    body = "\n".join(lines).rstrip()
    return body + "\n"


def merge_manus_scripts_into_slides(
    slides: list[dict[str, Any]],
    manus: dict[int, dict[str, str]],
) -> list[dict[str, Any]]:
    """When user attached Manus presentation MD, fill ``slide_script`` by slide index."""
    if not manus:
        return slides
    out: list[dict[str, Any]] = []
    for row in slides:
        spec = dict(row)
        idx = int(spec.get("index") or 0)
        block = manus.get(idx)
        if not isinstance(block, dict):
            out.append(spec)
            continue
        script = str(block.get("script") or "").strip()
        if script and not str(spec.get("slide_script") or "").strip():
            spec["slide_script"] = script[:6000]
        mtitle = str(block.get("title") or "").strip()
        if mtitle and str(spec.get("title") or "").strip().lower().startswith("slide "):
            spec["title"] = mtitle
        out.append(spec)
    return out


def apply_outline_fields_from_llm_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map LLM outline JSON row → ``slides_spec`` fields."""
    entry: dict[str, Any] = {}
    try:
        idx = int(row.get("index") or 0)
    except (TypeError, ValueError):
        return entry
    if idx < 1:
        return entry
    entry["index"] = idx
    entry["title"] = str(row.get("title") or f"Slide {idx}").strip() or f"Slide {idx}"
    entry["theme"] = str(row.get("theme") or "default").strip() or "default"
    layout = str(row.get("layout") or "").strip().lower()
    if layout:
        entry["layout"] = layout

    script = str(
        row.get("script")
        or row.get("speaker_notes")
        or row.get("speaker_script")
        or row.get("outline")
        or row.get("content")
        or row.get("body")
        or ""
    ).strip()
    bullets = _normalize_bullets(row.get("bullets") or row.get("key_points"))
    focus = str(row.get("focus") or row.get("teaching_brief") or "").strip()

    if script:
        entry["slide_script"] = script[:6000]
    if bullets:
        entry["outline_bullets"] = bullets
    if focus:
        entry["slide_teaching_brief"] = focus[:1200]
    elif script:
        entry["slide_teaching_brief"] = script[:1200]

    return entry
