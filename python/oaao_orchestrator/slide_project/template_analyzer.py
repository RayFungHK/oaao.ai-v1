"""PPTX (or profile JSON) → LLM → custom template JSON for slide catalog."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.planner_llm import _extract_json_object, llm_chat_completion_text
from oaao_orchestrator.slide_project.custom_templates import (
    allocate_import_template_id,
    safe_template_id,
    save_custom_template,
)
from oaao_orchestrator.slide_project.template_scope import (
    TemplateScopeContext,
    can_write_scope,
    normalize_scope,
)
from oaao_orchestrator.slide_project.deck_style import normalize_deck_style
from oaao_orchestrator.slide_project.pptx_profile import extract_pptx_profile, theme_from_profile
from oaao_orchestrator.slide_project.pptx_typography import (
    apply_typography_to_deck_style,
    enrich_profile_typography,
)
from oaao_orchestrator.slide_project.template_registry import catalog_version, layout_ids_for_outline_prompt, theme_ids
from oaao_orchestrator.slide_project.async_bridge import run_blocking, run_soffice_job

logger = logging.getLogger(__name__)


def _load_pptx_profile_bundle(pptx_path: Path) -> dict[str, Any]:
    """Blocking PPTX parse — python-pptx + geometry + typography."""
    profile = extract_pptx_profile(pptx_path)
    try:
        from oaao_orchestrator.slide_project.pptx_geometry import enrich_profile_with_geometry  # noqa: PLC0415

        profile = enrich_profile_with_geometry(pptx_path, profile)
    except Exception:  # noqa: BLE001
        logger.exception("template_analyze_geometry_enrich_failed")
    try:
        profile = enrich_profile_typography(pptx_path, profile)
    except Exception:  # noqa: BLE001
        logger.exception("template_analyze_typography_enrich_failed")
    return profile


def _apply_template_fonts_sync(
    pptx_path: Path,
    result: dict[str, Any],
    scope_ctx: TemplateScopeContext,
    scope_level: str,
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_pptx_preview import template_asset_dir  # noqa: PLC0415
    from oaao_orchestrator.slide_project.pptx_fonts import apply_pptx_fonts, verify_font_entries  # noqa: PLC0415

    asset = template_asset_dir(result, scope_ctx)
    if asset is None:
        return result
    profile = result.get("profile") if isinstance(result.get("profile"), dict) else {}
    fonts_meta = profile.get("fonts") if isinstance(profile.get("fonts"), dict) else {}
    font_manifest = apply_pptx_fonts(
        pptx_path,
        asset,
        fonts_meta,
        template_id=str(result.get("template_id") or ""),
    )
    if font_manifest and isinstance(result.get("deck_style"), dict):
        typo = result["deck_style"].get("typography")
        if not isinstance(typo, dict):
            typo = {}
        typo = dict(typo)
        typo["font_stack"] = str(font_manifest.get("font_stack") or typo.get("font_stack") or "")
        typo["font_faces"] = verify_font_entries(asset, font_manifest.get("entries") or [])
        result["deck_style"]["typography"] = typo
        result["fonts_manifest"] = "materials/fonts/manifest.json"
        return save_custom_template(result, scope_ctx, write_scope=scope_level)
    return result


def _apply_pptx_render_preview_sync(
    pptx_path: Path,
    result: dict[str, Any],
    scope_ctx: TemplateScopeContext,
) -> dict[str, Any] | None:
    from oaao_orchestrator.slide_project.template_pptx_preview import apply_pptx_render_preview  # noqa: PLC0415

    return apply_pptx_render_preview(pptx_path=pptx_path, row=result, ctx=scope_ctx)


def _save_template_masters_sync(
    result: dict[str, Any],
    scope_ctx: TemplateScopeContext,
    scope_level: str,
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_pptx_preview import template_asset_dir  # noqa: PLC0415
    from oaao_orchestrator.slide_project.pptx_master import save_template_masters  # noqa: PLC0415

    asset = template_asset_dir(result, scope_ctx)
    pages = result.get("pages")
    if asset is None or not isinstance(pages, list):
        return result
    theme = str(result.get("deck_theme") or result.get("template_id") or "default")
    deck_style = result.get("deck_style") if isinstance(result.get("deck_style"), dict) else None
    result["pages"] = save_template_masters(
        asset_dir=asset,
        pages=pages,
        theme=theme,
        deck_style=deck_style,
    )
    result["geometry_version"] = 1
    return save_custom_template(result, scope_ctx, write_scope=scope_level)


def _apply_pptx_materials_sync(
    pptx_path: Path,
    result: dict[str, Any],
    scope_ctx: TemplateScopeContext,
    scope_level: str,
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.pptx_materials import apply_pptx_materials  # noqa: PLC0415
    from oaao_orchestrator.slide_project.template_pptx_preview import template_asset_dir  # noqa: PLC0415

    asset = template_asset_dir(result, scope_ctx)
    if asset is None:
        return result
    src = asset / "source.pptx"
    if not src.is_file():
        src = pptx_path
    apply_pptx_materials(src, result, asset)
    return save_custom_template(result, scope_ctx, write_scope=scope_level)

_ANALYZE_SYSTEM = """You are a presentation template analyst. Output ONLY valid JSON (no fences):
{
  "template_id": "snake_case id (e.g. imported_teaching_blue)",
  "label": "short display name in user language",
  "deck_theme": "same as template_id for imported themes",
  "theme": { "bg": "#hex", "fg": "#hex", "muted": "#hex", "accent": "#hex", "card": "...", "bar": "#hex" },
  "deck_style": {
    "deck_theme": "...",
    "tone": "one sentence",
    "design_principles": ["3-5 rules"],
    "typography": { "font_stack": "...", "title_weight": "700", "body_size_rem": "1.05" },
    "colors": { same keys as theme },
    "slide_prompt": "how slides should fill 1280x720 using this look"
  },
  "layout_hints": ["layout ids from catalog to prefer"],
  "pages": [
    {
      "index": 1,
      "title": "short slide label (NOT body lorem)",
      "layout": "pptx_master",
      "slots": [
        {
          "slot_id": "title",
          "role": "headline",
          "kind": "headline",
          "max_chars": 40,
          "recipe": "one short headline for this box",
          "seed": "sample text from PPTX"
        }
      ],
      "slot_seeds": { "title": "optional legacy map" }
    }
  ],
  "notes": "brief",
  "micro_skills": {
    "version": 1,
    "agent_brief": "how agents map user material to this template",
    "pages": [
      {
        "index": 1,
        "layout_role": "cover|agenda|section|bullets|callouts|comparison|closing|generic",
        "use_when": "natural-language when to pick this master",
        "typography_notes": "title/body font roles",
        "color_notes": "palette tokens per region"
      }
    ],
    "typography": { "font_stack": "...", "rules": ["..."] },
    "colors": { "palette": { "bg": "#hex", "fg": "#hex", "accent": "#hex" }, "contrast_rules": ["..."] },
    "material_rules": ["how to place bullets/paragraphs into slots"]
  }
}
Rules:
- Infer palette from PPTX profile palette_hints and slide text (match imported deck colors/mood).
- PPTX profile includes computed locale, fonts, typography_hints — DO NOT contradict locale.primary or typography_hints.recommended_stack.
- If locale.primary is zh-Hant or zh-Hans, font_stack MUST include CJK UI fonts (e.g. Noto Sans TC/SC); never Arial-only for body/title.
- If typography_hints.locale_font_mismatch is set, mention it briefly in notes and still use recommended_stack.
- When profile slides include geometry_slots (pptx_master): set layout=pptx_master for each page; output slots[] with one object per geometry slot_id (same ids). Set max_chars from box size + sample text length (headlines ≤80, side labels ≤40, body ≤280). Never use FAQ/keyword heuristics.
- When geometry_slots absent: suggested_layout may use catalog layout ids; slot_seeds = short fragments per catalog slot.
- Page title must be a short heading (use geometry slot_id=title text), never a lorem paragraph.
- deck_style must be complete and usable for all slides in a deck.
- template_id must be lowercase snake_case, unique, no spaces.
- micro_skills: required when geometry_slots exist — one pages[] row per slide index; material_rules
  must guide layout pick, typography, and color pairing for user content (not placeholder lorem)."""


def _friendly_display_label(label: str | None, pptx_stem: str | None) -> str:
    """Avoid showing server upload ids (import_<hex>) as the gallery title."""
    for candidate in (label, pptx_stem):
        text = (candidate or "").strip()
        if not text:
            continue
        lower = text.lower()
        if lower.startswith("import_") and len(lower) > 14:
            continue
        if lower in ("imported_deck", "deck", "new template"):
            continue
        return text
    return "Imported template"


def _heuristic_template(
    profile: dict[str, Any],
    label: str | None = None,
    *,
    pptx_stem: str | None = None,
) -> dict[str, Any]:
    """Fallback when LLM unavailable — light corporate default."""
    tid = allocate_import_template_id(label=label, pptx_stem=pptx_stem)
    display = _friendly_display_label(label, pptx_stem)
    theme = theme_from_profile(profile) or {
        "bg": "#f8fafc",
        "fg": "#0f172a",
        "muted": "#475569",
        "accent": "#2563eb",
        "card": "rgba(15,23,42,0.06)",
        "bar": "#2563eb",
    }
    deck_style = normalize_deck_style(
        {
            "deck_theme": tid,
            "tone": f"{display} — imported PPTX structure",
            "colors": theme,
            "slide_prompt": "Fill 1280×720; preserve imported PPTX color rhythm, typography weight, and slide density.",
        },
        fallback_theme=tid,
    )
    deck_style = apply_typography_to_deck_style(deck_style, profile)
    deck_style["deck_theme"] = tid
    from oaao_orchestrator.slide_project.template_pages import build_template_pages  # noqa: PLC0415

    layout_hints = ["two_column", "title_content", "three_cards"]
    return {
        "template_id": tid,
        "label": display,
        "deck_theme": tid,
        "theme": theme,
        "deck_style": deck_style,
        "layout_hints": layout_hints,
        "pages": build_template_pages(profile, layout_hints=layout_hints),
        "notes": "Heuristic palette (LLM not configured).",
        "profile": profile,
        "catalog_version": catalog_version(),
    }


async def analyze_pptx_template(
    *,
    pptx_path: Path,
    url: str | None,
    api_key: str | None,
    model: str | None,
    label: str | None = None,
    user_notes: str | None = None,
    persist: bool = True,
    ctx: TemplateScopeContext | None = None,
    write_scope: str | None = None,
) -> dict[str, Any]:
    """
    Extract PPTX profile → LLM art direction → optional save under custom_templates/.
    """
    scope_ctx = ctx or TemplateScopeContext(user_id=0)
    scope_level = normalize_scope(write_scope, default="personal")

    if not pptx_path.is_file():
        raise FileNotFoundError(f"pptx not found: {pptx_path}")

    profile = await run_blocking(_load_pptx_profile_bundle, pptx_path)
    pptx_stem = pptx_path.stem
    if not url or not model:
        result = _heuristic_template(profile, label, pptx_stem=pptx_stem)
        if persist:
            result["status"] = "draft"
            result["scope"] = scope_level
            result = await run_blocking(
                save_custom_template,
                result,
                scope_ctx,
                write_scope=scope_level,
            )
        return result

    profile_json = json.dumps(profile, ensure_ascii=False)[:12000]
    user = (
        f"User label: {label or '(none)'}\n"
        f"Notes: {(user_notes or '').strip()[:2000]}\n"
        f"Catalog layout ids: {layout_ids_for_outline_prompt()}\n"
        f"Builtin theme ids (reference only): {'|'.join(sorted(theme_ids()))}\n\n"
        f"PPTX profile:\n{profile_json}"
    )
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": _ANALYZE_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.25,
        timeout_s=90.0,
    )
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        logger.warning("template_analyze_json_parse_failed")
        result = _heuristic_template(profile, label, pptx_stem=pptx_stem)
    else:
        tid = allocate_import_template_id(
            label=str(obj.get("label") or label or ""),
            pptx_stem=pptx_stem,
        )
        theme_raw = obj.get("theme") if isinstance(obj.get("theme"), dict) else {}
        deck_raw = obj.get("deck_style") if isinstance(obj.get("deck_style"), dict) else {}
        profile_theme = theme_from_profile(profile)
        deck_style = normalize_deck_style(deck_raw, fallback_theme=tid)
        llm_typo = deck_raw.get("typography") if isinstance(deck_raw.get("typography"), dict) else None
        deck_style = apply_typography_to_deck_style(
            deck_style,
            profile,
            llm_typography=llm_typo,
        )
        deck_style["deck_theme"] = tid
        merged_colors = {**profile_theme, **dict(deck_style.get("colors") or {})}
        if isinstance(theme_raw, dict):
            merged_colors.update({k: str(v) for k, v in theme_raw.items() if isinstance(v, str)})
        if merged_colors:
            deck_style["colors"] = merged_colors
        hints = obj.get("layout_hints")
        layout_hints = [str(x) for x in hints][:8] if isinstance(hints, list) else []
        llm_label = str(obj.get("label") or "").strip()
        llm_pages = obj.get("pages") if isinstance(obj.get("pages"), list) else None
        from oaao_orchestrator.slide_project.template_pages import build_template_pages  # noqa: PLC0415

        pages = build_template_pages(profile, layout_hints=layout_hints, llm_pages=llm_pages)
        notes = str(obj.get("notes") or "").strip()
        typo = deck_style.get("typography")
        if isinstance(typo, dict):
            warn = typo.get("locale_font_warning")
            if isinstance(warn, str) and warn.strip() and warn not in notes:
                notes = f"{notes} {warn}".strip() if notes else warn.strip()
        from oaao_orchestrator.slide_project.template_micro_skills import (  # noqa: PLC0415
            normalize_micro_skills,
        )

        micro_raw = obj.get("micro_skills")
        micro = normalize_micro_skills(micro_raw) if isinstance(micro_raw, dict) else None
        result = {
            "template_id": tid,
            "label": _friendly_display_label(llm_label or label, pptx_stem),
            "deck_theme": tid,
            "theme": deck_style.get("colors") or theme_raw,
            "deck_style": deck_style,
            "layout_hints": layout_hints,
            "pages": pages,
            "notes": notes,
            "profile": profile,
            "catalog_version": catalog_version(),
        }
        if micro:
            result["micro_skills"] = micro

    if persist:
        if isinstance(result.get("deck_style"), dict):
            result["deck_style"]["deck_theme"] = str(result.get("template_id") or "")
        result["status"] = "draft"
        result["scope"] = scope_level
        result = await run_blocking(
            save_custom_template,
            result,
            scope_ctx,
            write_scope=scope_level,
        )
        try:
            result = await run_blocking(
                _apply_template_fonts_sync,
                pptx_path,
                result,
                scope_ctx,
                scope_level,
            )
        except Exception:  # noqa: BLE001
            logger.exception("template_pptx_fonts_before_render_failed")
        try:
            render_summary = await run_soffice_job(
                _apply_pptx_render_preview_sync,
                pptx_path,
                result,
                scope_ctx,
            )
            if render_summary:
                result["preview_mode"] = "pptx_render"
                result["thumbnail_source"] = "pptx_render"
                result["preview_pages"] = render_summary.get("pages") or []
                result["status"] = "preview"
        except Exception:  # noqa: BLE001
            logger.exception("template_pptx_render_after_analyze_failed")
        try:
            result = await run_blocking(
                _save_template_masters_sync,
                result,
                scope_ctx,
                scope_level,
            )
            from oaao_orchestrator.slide_project.template_pptx_preview import template_asset_dir  # noqa: PLC0415
            from oaao_orchestrator.slide_project.template_slot_plan import (  # noqa: PLC0415
                refine_pages_with_master_html_llm,
            )

            asset = template_asset_dir(result, scope_ctx)
            if asset is not None and isinstance(result.get("pages"), list):
                profile_for_refine = (
                    result.get("profile") if isinstance(result.get("profile"), dict) else profile
                )
                refined_pages = await refine_pages_with_master_html_llm(
                    url=url,
                    api_key=api_key,
                    model=model,
                    profile=profile_for_refine,
                    pages=result["pages"],
                    asset_dir=asset,
                    label=str(result.get("label") or ""),
                )
                if refined_pages:
                    result["pages"] = refined_pages
                    result["slot_refine_pass"] = 2
                    result = await run_blocking(
                        save_custom_template,
                        result,
                        scope_ctx,
                        write_scope=scope_level,
                    )
                from oaao_orchestrator.slide_project.template_micro_skills import (  # noqa: PLC0415
                    generate_micro_skills_llm,
                    normalize_micro_skills,
                )

                if not isinstance(result.get("micro_skills"), dict):
                    generated = await generate_micro_skills_llm(
                        url=url,
                        api_key=api_key,
                        model=model,
                        template_label=str(result.get("label") or ""),
                        deck_style=result.get("deck_style")
                        if isinstance(result.get("deck_style"), dict)
                        else None,
                        pages=result.get("pages") if isinstance(result.get("pages"), list) else [],
                        profile=profile_for_refine,
                    )
                    if generated:
                        result["micro_skills"] = generated
                        result = await run_blocking(
                            save_custom_template,
                            result,
                            scope_ctx,
                            write_scope=scope_level,
                        )
                else:
                    merged = normalize_micro_skills(result.get("micro_skills"))
                    if merged:
                        result["micro_skills"] = merged
                preview_pages = result.get("preview_pages")
                if isinstance(preview_pages, list):
                    from oaao_orchestrator.slide_project.template_pages import (  # noqa: PLC0415
                        merge_pages_into_preview_rows,
                    )

                    result["preview_pages"] = merge_pages_into_preview_rows(
                        preview_pages,
                        result["pages"],
                        template_id=str(result.get("template_id") or ""),
                    )
                    result = await run_blocking(
                        save_custom_template,
                        result,
                        scope_ctx,
                        write_scope=scope_level,
                    )
        except Exception:  # noqa: BLE001
            logger.exception("template_pptx_master_save_failed")
        try:
            result = await run_blocking(
                _apply_pptx_materials_sync,
                pptx_path,
                result,
                scope_ctx,
                scope_level,
            )
        except Exception:  # noqa: BLE001
            logger.exception("template_pptx_materials_failed")
    return result
