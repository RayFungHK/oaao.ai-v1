"""
JSON template catalog for slide layouts, themes, plan rules, and CSS.

Add a new slide look by editing templates/*.json (and reusing an existing `component`).
Python only needs a new `component` handler when the composition is genuinely new.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_TOKEN_RE = re.compile(r"\{\{([a-z_]+)\}\}")


@lru_cache(maxsize=1)
def catalog() -> dict[str, Any]:
    path = _TEMPLATES_DIR / "catalog.json"
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def catalog_version() -> int:
    return int(catalog().get("version") or 1)


def _load_json(name: str) -> dict[str, Any]:
    rel = str((catalog().get("files") or {}).get(name) or name)
    path = _TEMPLATES_DIR / rel
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


@lru_cache(maxsize=1)
def themes_data() -> dict[str, Any]:
    return _load_json("themes")


@lru_cache(maxsize=1)
def layouts_data() -> dict[str, Any]:
    return _load_json("layouts")


@lru_cache(maxsize=1)
def plan_data() -> dict[str, Any]:
    return _load_json("plan")


@lru_cache(maxsize=1)
def default_deck_style() -> dict[str, Any]:
    rel = str((catalog().get("files") or {}).get("deck_style_default") or "deck_style.default.json")
    path = _TEMPLATES_DIR / rel
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


@lru_cache(maxsize=1)
def styles_template() -> str:
    rel = str((catalog().get("files") or {}).get("styles") or "styles.css.tpl")
    return (_TEMPLATES_DIR / rel).read_text(encoding="utf-8")


def reload_templates() -> None:
    """Clear caches after hot-editing templates/*.json in dev."""
    catalog.cache_clear()
    themes_data.cache_clear()
    layouts_data.cache_clear()
    plan_data.cache_clear()
    default_deck_style.cache_clear()
    styles_template.cache_clear()


def theme_ids() -> frozenset[str]:
    from oaao_orchestrator.slide_project.custom_templates import (
        list_published_template_ids,
    )

    themes = themes_data().get("themes")
    builtin: set[str] = set()
    if isinstance(themes, dict):
        builtin = {str(k) for k in themes}
    custom: set[str] = set(list_published_template_ids())
    return frozenset(builtin | custom or {"default"})


def layout_ids() -> frozenset[str]:
    layouts = layouts_data().get("layouts")
    if isinstance(layouts, dict):
        return frozenset(str(k) for k in layouts)
    return frozenset()


def get_layout(layout_id: str) -> dict[str, Any] | None:
    layouts = layouts_data().get("layouts")
    if not isinstance(layouts, dict):
        return None
    row = layouts.get(layout_id)
    return dict(row) if isinstance(row, dict) else None


def layout_component(layout_id: str) -> str:
    row = get_layout(layout_id)
    if not row:
        return layout_id
    return str(row.get("component") or layout_id).strip() or layout_id


def resolve_layout_id(raw: str) -> str | None:
    lid = (raw or "").strip().lower()
    if not lid:
        return None
    if lid in layout_ids():
        return lid
    layouts = layouts_data().get("layouts")
    if isinstance(layouts, dict):
        for key, row in layouts.items():
            if not isinstance(row, dict):
                continue
            aliases = row.get("aliases")
            if isinstance(aliases, list) and lid in [str(a).lower() for a in aliases]:
                return str(key)
    return None


def palette(theme: str, deck_style: dict[str, Any] | None = None) -> dict[str, str]:
    from oaao_orchestrator.slide_project.custom_templates import (
        load_custom_template_by_id,
    )

    themes = themes_data().get("themes")
    base: dict[str, str] = {}
    custom = load_custom_template_by_id(theme)
    if custom and isinstance(custom.get("theme"), dict):
        base = {str(k): str(v) for k, v in custom["theme"].items() if isinstance(v, str)}
    elif isinstance(themes, dict) and theme in themes and isinstance(themes[theme], dict):
        base = {str(k): str(v) for k, v in themes[theme].items()}
    elif isinstance(themes, dict) and "default" in themes:
        base = {str(k): str(v) for k, v in themes["default"].items()}
    if isinstance(deck_style, dict) and isinstance(deck_style.get("colors"), dict):
        for key in ("bg", "fg", "muted", "accent", "card", "bar"):
            val = deck_style["colors"].get(key)
            if isinstance(val, str) and val.strip():
                base[key] = val.strip()
    return base


def build_layout_css(
    theme: str,
    layout_id: str,
    deck_style: dict[str, Any] | None = None,
) -> str:
    p = palette(theme, deck_style)
    typo = deck_style.get("typography") if isinstance(deck_style, dict) else {}
    tokens = {
        **p,
        "layout": layout_id,
        "font_stack": (
            str(typo.get("font_stack") or "").strip()
            if isinstance(typo, dict)
            else 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", sans-serif'
        ),
        "body_size": (
            str(typo.get("body_size_rem") or "1.08").strip() if isinstance(typo, dict) else "1.08"
        ),
    }

    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        return tokens.get(key, match.group(0))

    return _TOKEN_RE.sub(_sub, styles_template())


def layout_slots(layout_id: str) -> list[dict[str, Any]]:
    """Named content slots for per-slot LLM generation ({@see slot_content})."""
    from oaao_orchestrator.slide_project.slot_content import layout_slot_defs

    return layout_slot_defs(layout_id)


def layout_content_recipe(layout_id: str) -> str:
    row = get_layout(layout_id)
    if row and isinstance(row.get("content_recipe"), str):
        return str(row["content_recipe"]).strip()
    return "Lead paragraph + 4–5 bullets."


def layout_html_prompt(layout_id: str, theme: str) -> str:
    row = get_layout(layout_id)
    hint = str(row.get("html_prompt") or "").strip() if row else ""
    return f"Layout: {layout_id}. Theme palette: {theme}. {hint} MUST fill 1280×720 — no empty lower third."


def layout_ids_for_outline_prompt() -> str:
    return "|".join(sorted(layout_ids()))


def plan_rules() -> dict[str, Any]:
    return plan_data()


def middle_rotation() -> tuple[str, ...]:
    raw = plan_data().get("middle_rotation")
    if isinstance(raw, list):
        return tuple(str(x).strip() for x in raw if str(x).strip())
    return tuple()


def max_per_layout() -> dict[str, int]:
    raw = plan_data().get("max_per_layout")
    if isinstance(raw, dict):
        return {str(k): int(v) for k, v in raw.items()}
    return {}


def title_hint_layout(title: str) -> str | None:
    """
    CS-AUDIT-3 — deprecated keyword routing from ``plan.json`` ``title_hints``.

    Per-deck layout uses ``middle_rotation``, first/second/last rules, and
    ``template_micro_skills`` LLM page pick — not title keyword lists.
    """
    del title  # unused
    return None


def export_catalog_snapshot() -> dict[str, Any]:
    """Embed in project manifest so renders are traceable to a catalog version."""
    return {
        "catalog_version": catalog_version(),
        "layout_ids": sorted(layout_ids()),
        "theme_ids": sorted(theme_ids()),
    }
