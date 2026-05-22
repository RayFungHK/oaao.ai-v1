"""Deck-wide visual style — generated once per project so every slide shares one design system."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text
from oaao_orchestrator.slide_project.llm import _user_topic
from oaao_orchestrator.slide_project.template_registry import (
    default_deck_style as _load_default_deck_style,
    palette as registry_palette,
    theme_ids,
)

logger = logging.getLogger(__name__)

DECK_THEME_IDS = theme_ids()
DEFAULT_DECK_STYLE: dict[str, Any] = dict(_load_default_deck_style())

_STYLE_SYSTEM = """You are a presentation art director. Output ONLY valid JSON (no fences):
{
  "deck_theme": "<one of catalog theme ids>",
  "tone": "one sentence visual tone",
  "design_principles": ["3-5 rules for ALL slides in this deck"],
  "typography": { "font_stack": "...", "title_weight": "700", "body_size_rem": "1.05" },
  "colors": { "bg": "#hex", "fg": "#hex", "muted": "#hex", "accent": "#hex", "card": "...", "bar": "#hex" },
  "slide_prompt": "2-3 sentences: how every slide should look and fill the 1280x720 frame"
}
Rules:
- Pick ONE deck_theme for the entire deck (do not mix light/dark across slides).
- executive_problem = dark navy teaching; platform_layers = light + cards; default = light corporate.
- design_principles MUST include filling the full slide and consistent spacing/typography.
- colors must be harmonious and meet contrast for text on bg.
- Match user language and subject (handbook/teaching → professional, readable)."""


def _merge_palette(theme: str, colors: dict[str, Any] | None) -> dict[str, str]:
    overlay: dict[str, Any] | None = {"colors": colors} if isinstance(colors, dict) else None
    return registry_palette(theme, overlay)


def normalize_deck_style(raw: dict[str, Any] | None, *, fallback_theme: str = "default") -> dict[str, Any]:
    out = dict(DEFAULT_DECK_STYLE)
    if not isinstance(raw, dict):
        raw = {}
    from oaao_orchestrator.slide_project.custom_templates import load_custom_template_by_id  # noqa: PLC0415

    theme = str(raw.get("deck_theme") or fallback_theme).strip()
    raw_colors = raw.get("colors") if isinstance(raw.get("colors"), dict) else {}
    has_import_colors = any(isinstance(v, str) and str(v).strip() for v in raw_colors.values())
    if theme not in DECK_THEME_IDS and load_custom_template_by_id(theme) is None and not has_import_colors:
        theme = str(DEFAULT_DECK_STYLE["deck_theme"])
    out["deck_theme"] = theme
    if isinstance(raw.get("tone"), str) and raw["tone"].strip():
        out["tone"] = raw["tone"].strip()
    pr = raw.get("design_principles")
    if isinstance(pr, list) and pr:
        out["design_principles"] = [str(x).strip() for x in pr if str(x).strip()][:6]
    if isinstance(raw.get("typography"), dict):
        out["typography"] = {**dict(out.get("typography") or {}), **raw["typography"]}
    out["colors"] = _merge_palette(theme, raw.get("colors") if isinstance(raw.get("colors"), dict) else None)
    if isinstance(raw.get("slide_prompt"), str) and raw["slide_prompt"].strip():
        out["slide_prompt"] = raw["slide_prompt"].strip()
    return out


def load_deck_style(project_dir: Path) -> dict[str, Any]:
    path = project_dir / "deck_style.json"
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return normalize_deck_style(data)
        except (json.JSONDecodeError, OSError):
            pass
    manifest_path = project_dir / "project.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(manifest, dict) and isinstance(manifest.get("deck_style"), dict):
                return normalize_deck_style(manifest["deck_style"])
        except (json.JSONDecodeError, OSError):
            pass
    return normalize_deck_style(None)


def save_deck_style(project_dir: Path, style: dict[str, Any]) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    normalized = normalize_deck_style(style)
    (project_dir / "deck_style.json").write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def apply_deck_style_to_slides(slides_spec: list[dict[str, Any]], style: dict[str, Any]) -> list[dict[str, Any]]:
    """Lock per-slide theme to deck-wide palette; assign varied layouts per slide."""
    from oaao_orchestrator.slide_project.layout_plan import diversify_slide_layouts  # noqa: PLC0415

    theme = str(style.get("deck_theme") or "default")
    out: list[dict[str, Any]] = []
    for spec in slides_spec:
        row = dict(spec)
        row["theme"] = theme
        out.append(row)
    return diversify_slide_layouts(out)


def style_prompt_block(style: dict[str, Any]) -> str:
    principles = style.get("design_principles") or []
    lines = [
        f"Deck visual system (LOCKED for all slides): {style.get('tone', '')}",
        f"Palette theme: {style.get('deck_theme', 'default')}",
        str(style.get("slide_prompt") or ""),
    ]
    if isinstance(principles, list):
        lines.append("Design principles:")
        lines.extend(f"- {p}" for p in principles[:5] if str(p).strip())
    colors = style.get("colors")
    if isinstance(colors, dict):
        lines.append(
            "Colors: "
            + ", ".join(f"{k}={colors[k]}" for k in ("bg", "fg", "accent", "muted") if colors.get(k))
        )
    return "\n".join(lines)


async def generate_deck_style(
    *,
    url: str | None,
    api_key: str | None,
    model: str | None,
    messages: list[dict[str, Any]],
    deck_title: str,
    slides_spec: list[dict[str, Any]],
) -> dict[str, Any]:
    """LLM art-direction pass after outline — one style for the whole deck."""
    hints = [str(s.get("title") or "") for s in slides_spec[:12]]
    topic = _user_topic(messages, max_chars=2000)
    dominant = "default"
    for s in slides_spec:
        t = str(s.get("theme") or "").strip()
        if t in DECK_THEME_IDS:
            dominant = t
            break

    if not url or not model:
        style = normalize_deck_style({"deck_theme": dominant}, fallback_theme=dominant)
        style["tone"] = f"{deck_title} — {topic[:80]}"
        return style

    user = (
        f"Deck title: {deck_title}\n"
        f"Slide outline ({len(slides_spec)} pages):\n"
        + "\n".join(f"- {h}" for h in hints if h)
        + f"\n\nUser / brand context:\n{topic[:2500]}\n"
        f"Planner suggested palette family: {dominant}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _STYLE_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.25,
        timeout_s=60.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("deck_style_json_parse_failed")
        return normalize_deck_style({"deck_theme": dominant}, fallback_theme=dominant)
    return normalize_deck_style(obj, fallback_theme=dominant)
