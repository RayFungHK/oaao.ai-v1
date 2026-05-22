"""Apply LibreOffice PPTX slide renders to template preview manifest + gallery thumbnail."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from oaao_orchestrator.slide_project.custom_templates import (
    load_custom_template,
    save_custom_template,
    save_preview_manifest,
)
from oaao_orchestrator.slide_project.pptx_profile import profile_slides_for_template
from oaao_orchestrator.slide_project.pptx_render import pptx_render_available, render_pptx_to_pngs
from oaao_orchestrator.slide_project.template_scope import (
    TemplateScopeContext,
    normalize_scope,
    partition_ids,
)

logger = logging.getLogger(__name__)


def _template_render_api_path(template_id: str, page: int) -> str:
    q = {"template_id": template_id, "page": max(1, page)}
    return "/slide-designer/api/template_render?" + urlencode(q)


def archive_source_pptx(
    pptx_path: Path,
    row: dict[str, Any],
    ctx: TemplateScopeContext | None = None,
) -> Path | None:
    """Copy uploaded PPTX beside template JSON for later re-render."""
    asset = template_asset_dir(row, ctx)
    if asset is None:
        return None
    asset.mkdir(parents=True, exist_ok=True)
    dest = asset / "source.pptx"
    try:
        shutil.copy2(pptx_path, dest)
        return dest
    except OSError as exc:
        logger.warning("archive_source_pptx_failed id=%s err=%s", row.get("template_id"), exc)
        return None


def template_asset_dir(row: dict[str, Any], ctx: TemplateScopeContext | None = None) -> Path | None:
    from oaao_orchestrator.slide_project.custom_templates import (  # noqa: PLC0415
        safe_template_id,
        _scope_base,
    )

    tid = safe_template_id(str(row.get("template_id") or ""))
    if not tid:
        return None
    scope = normalize_scope(str(row.get("scope") or "personal"))
    tenant_id: int | None = None
    owner_user_id: int | None = None
    if ctx is not None:
        _, tenant_id, owner_user_id = partition_ids(ctx, scope)
    else:
        raw_tid = row.get("tenant_id")
        raw_owner = row.get("owner_user_id") or row.get("created_by")
        if raw_tid is not None and str(raw_tid).strip().isdigit():
            tenant_id = int(raw_tid)
        if raw_owner is not None and str(raw_owner).strip().isdigit():
            owner_user_id = int(raw_owner)
    return _scope_base(scope, tenant_id, owner_user_id) / tid


def apply_pptx_render_preview(
    *,
    pptx_path: Path,
    row: dict[str, Any],
    ctx: TemplateScopeContext,
    max_slides: int | None = None,
) -> dict[str, Any] | None:
    """
    Render PPTX slides to PNG, write manifest, update template row fields.
    Returns summary dict or None when render skipped/failed.
    """
    if not pptx_path.is_file():
        return None

    asset = template_asset_dir(row, ctx)
    if asset is None:
        return None

    archived = archive_source_pptx(pptx_path, row, ctx)
    render_dir = asset / "render"
    if render_dir.exists():
        for old in render_dir.glob("*.png"):
            try:
                old.unlink()
            except OSError:
                pass

    try:
        from oaao_orchestrator.slide_project.pptx_fonts import apply_pptx_fonts  # noqa: PLC0415

        profile = row.get("profile") if isinstance(row.get("profile"), dict) else {}
        fonts_meta = profile.get("fonts") if isinstance(profile.get("fonts"), dict) else {}
        apply_pptx_fonts(
            pptx_path,
            asset,
            fonts_meta,
            template_id=str(row.get("template_id") or ""),
        )
    except Exception:  # noqa: BLE001
        logger.exception("pptx_fonts_before_render_failed template=%s", row.get("template_id"))

    pngs = render_pptx_to_pngs(pptx_path, render_dir, max_slides=max_slides, asset_dir=asset)
    if not pngs:
        if not pptx_render_available():
            logger.info("pptx_render_unavailable template=%s", row.get("template_id"))
        return None

    profile_slides = profile_slides_for_template(row)
    from oaao_orchestrator.slide_project.template_pages import (  # noqa: PLC0415
        build_template_pages,
        merge_pages_into_preview_rows,
    )

    profile_dict = row.get("profile") if isinstance(row.get("profile"), dict) else {"slides": profile_slides}
    archived = asset / "source.pptx"
    if archived.is_file():
        try:
            from oaao_orchestrator.slide_project.pptx_geometry import enrich_profile_with_geometry  # noqa: PLC0415

            profile_dict = enrich_profile_with_geometry(archived, profile_dict)
            from oaao_orchestrator.slide_project.pptx_typography import enrich_profile_typography  # noqa: PLC0415

            profile_dict = enrich_profile_typography(archived, profile_dict)
            row["profile"] = profile_dict
            ds = row.get("deck_style")
            if isinstance(ds, dict):
                from oaao_orchestrator.slide_project.pptx_typography import (  # noqa: PLC0415
                    apply_typography_to_deck_style,
                )

                row["deck_style"] = apply_typography_to_deck_style(ds, profile_dict)
        except Exception:  # noqa: BLE001
            logger.exception("pptx_render_geometry_enrich_failed template=%s", row.get("template_id"))

    template_pages = row.get("pages")
    if not isinstance(template_pages, list) or not template_pages:
        hints = row.get("layout_hints")
        hint_list = [str(x) for x in hints] if isinstance(hints, list) else None
        template_pages = build_template_pages(profile_dict, layout_hints=hint_list)
        row["pages"] = template_pages

    pages: list[dict[str, Any]] = []
    for i, png in enumerate(pngs, start=1):
        prof = profile_slides[i - 1] if i - 1 < len(profile_slides) else {}
        title = str(prof.get("title_guess") or f"Slide {i}") if isinstance(prof, dict) else f"Slide {i}"
        pages.append(
            {
                "index": i,
                "title": title[:120],
                "layout": "pptx_render",
                "render_path": f"render/{png.name}",
                "verified": True,
                "validation_errors": [],
                "preview_url": _template_render_api_path(str(row.get("template_id") or ""), i),
            }
        )
    tid = str(row.get("template_id") or "")
    pages = merge_pages_into_preview_rows(pages, template_pages, template_id=tid)
    try:
        from oaao_orchestrator.slide_project.pptx_master import save_template_masters  # noqa: PLC0415

        theme = str(row.get("deck_theme") or row.get("template_id") or "default")
        deck_style = row.get("deck_style") if isinstance(row.get("deck_style"), dict) else None
        template_pages = save_template_masters(
            asset_dir=asset,
            pages=template_pages,
            theme=theme,
            deck_style=deck_style,
        )
        row["pages"] = template_pages
        tid = str(row.get("template_id") or "")
        pages = merge_pages_into_preview_rows(pages, template_pages, template_id=tid)
    except Exception:  # noqa: BLE001
        logger.exception("pptx_render_master_save_failed template=%s", row.get("template_id"))

    manifest = {
        "template_id": str(row.get("template_id") or ""),
        "slide_count": len(pages),
        "preview_mode": "pptx_render",
        "pages": pages,
    }
    save_preview_manifest(str(row.get("template_id") or ""), manifest, row)

    patch: dict[str, Any] = {
        "thumbnail_source": "pptx_render",
        "thumbnail_page": 1,
        "preview_mode": "pptx_render",
        "preview_pages": pages,
        "pages": template_pages,
        "geometry_version": 1,
        "status": "preview",
    }
    if archived is not None:
        patch["source_pptx_path"] = str(archived)

    merged = {**row, **patch}
    save_custom_template(merged, ctx, write_scope=normalize_scope(str(row.get("scope") or "personal")))

    try:
        from oaao_orchestrator.slide_project.pptx_materials import apply_pptx_materials  # noqa: PLC0415

        src = archived if archived is not None and archived.is_file() else pptx_path
        apply_pptx_materials(src, merged, asset)
        save_custom_template(merged, ctx, write_scope=normalize_scope(str(row.get("scope") or "personal")))
    except Exception:  # noqa: BLE001
        logger.exception("pptx_materials_after_render_failed template=%s", row.get("template_id"))

    return {
        "preview_mode": "pptx_render",
        "slide_count": len(pages),
        "pages": pages,
        "thumbnail_source": "pptx_render",
    }


def try_regenerate_pptx_render_preview(
    template_id: str,
    ctx: TemplateScopeContext,
) -> dict[str, Any] | None:
    """Re-render from archived source.pptx when present."""
    template = load_custom_template(template_id, ctx)
    if template is None:
        return None
    src_raw = str(template.get("source_pptx_path") or "").strip()
    if not src_raw:
        asset = template_asset_dir(template, ctx)
        candidate = asset / "source.pptx" if asset is not None else None
        if candidate is None or not candidate.is_file():
            return None
        src_path = candidate
    else:
        src_path = Path(src_raw)
        if not src_path.is_file():
            asset = template_asset_dir(template, ctx)
            fallback = asset / "source.pptx" if asset is not None else None
            if fallback is None or not fallback.is_file():
                return None
            src_path = fallback
    return apply_pptx_render_preview(pptx_path=src_path, row=template, ctx=ctx)
