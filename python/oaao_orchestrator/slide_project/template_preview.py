"""Template preview pipeline — dummy slides, validate/fix loop, publish."""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urlencode

from oaao_orchestrator.slide_project.custom_templates import (
    _load_preview_manifest_for_row,
    delete_custom_template,
    load_custom_template,
    preview_slide_path,
    save_preview_manifest,
    template_preview_root,
    update_template_fields,
)
from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html, validate_slide_layout
from oaao_orchestrator.slide_project.llm import _rich_fallback_markdown, generate_slide_markdown
from oaao_orchestrator.slide_project.regenerate import _generate_validated_slide_html
from oaao_orchestrator.slide_project.store import _env_int, _persist_slide_html
from oaao_orchestrator.slide_project.template_scope import TemplateScopeContext

logger = logging.getLogger(__name__)


def _template_preview_html_api_path(template_id: str, page: int) -> str:
    q: dict[str, str | int] = {"template_id": template_id, "page": max(1, page)}
    return "/slide-designer/api/template_preview_html?" + urlencode(q)


def _enrich_preview_pages(template_id: str, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in pages:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        idx = int(row.get("index") or 0)
        if idx > 0:
            row["preview_url"] = _template_preview_html_api_path(template_id, idx)
        out.append(row)
    return out


def _load_manifest(
    template_id: str, ctx: TemplateScopeContext
) -> tuple[dict[str, Any], dict[str, Any]]:
    template = load_custom_template(template_id, ctx)
    if template is None:
        raise FileNotFoundError(f"template not found: {template_id}")
    manifest = _load_preview_manifest_for_row(template)
    manifest.setdefault("template_id", template_id)
    return template, manifest


_LAYOUT_FALLBACK_TITLES: dict[str, str] = {
    "title_hero": "Cover",
    "two_column": "Two column",
    "three_cards": "Three cards",
    "title_content": "Title and body",
    "faq_split": "FAQ",
    "metric_row": "Metrics",
    "quote_focus": "Quote",
    "section_divider": "Section",
    "summary": "Summary",
}


def _profile_slides(template: dict[str, Any]) -> list[dict[str, Any]]:
    profile = template.get("profile")
    if not isinstance(profile, dict):
        return []
    slides = profile.get("slides")
    if not isinstance(slides, list):
        return []
    return [s for s in slides if isinstance(s, dict)]


def _markdown_from_pptx_text(title: str, text_sample: str, *, deck_label: str) -> str:
    lines = [f"# {title.strip() or deck_label}"]
    body = (text_sample or "").strip()
    if not body:
        lines.append("")
        lines.append(f"*Imported from **{deck_label}***")
        return "\n".join(lines)
    for raw in body.split("\n"):
        s = raw.strip()
        if not s:
            continue
        if re.match(r"^[-•*]\s", s):
            lines.append(s if s.startswith("-") else f"- {s.lstrip('•* ')}")
        elif len(lines) <= 2 and not any(line.startswith("-") for line in lines[1:]):
            lines.append(f"## {s}")
        else:
            lines.append(f"- {s}")
    return "\n".join(lines[:24])


def _preview_specs(template: dict[str, Any]) -> list[dict[str, Any]]:
    tid = str(template.get("template_id") or "template")
    theme = str(template.get("deck_theme") or tid)
    label = str(template.get("label") or tid)
    profile_slides = _profile_slides(template)
    hints_raw = template.get("layout_hints")
    hints: list[str] = []
    if isinstance(hints_raw, list):
        hints = [str(x).strip() for x in hints_raw if str(x).strip()]
    if not hints:
        hints = ["two_column", "three_cards", "title_content"]

    layouts: list[str] = ["title_hero"]
    for h in hints:
        if h not in layouts and h not in ("title_hero", "summary"):
            layouts.append(h)
        if len(layouts) >= 5:
            break
    if "summary" not in layouts:
        layouts.append("summary")

    specs: list[dict[str, Any]] = []
    for i, layout in enumerate(layouts, start=1):
        prof = profile_slides[0] if layout == "title_hero" and profile_slides else None
        if prof is None and i - 1 < len(profile_slides):
            prof = profile_slides[i - 1]
        title = _LAYOUT_FALLBACK_TITLES.get(layout, layout)
        body_hint = ""
        use_pptx_body = False
        if isinstance(prof, dict):
            title = str(prof.get("title_guess") or title).strip() or title
            body_hint = str(prof.get("text_sample") or "").strip()
            use_pptx_body = bool(body_hint) and layout == "title_hero"
        if layout == "title_hero" and not body_hint and label:
            title = label
        specs.append(
            {
                "index": i,
                "title": title[:120],
                "layout": layout,
                "theme": theme,
                "body_hint": body_hint[:800],
                "use_pptx_body": use_pptx_body,
            }
        )
    return specs


def _preview_root_for_row(row: dict[str, Any], template_id: str):
    from oaao_orchestrator.slide_project.template_scope import normalize_scope

    scope = normalize_scope(str(row.get("scope") or "personal"))
    tenant_id = row.get("tenant_id")
    owner = row.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    return template_preview_root(
        template_id,
        scope=scope,
        tenant_id=tid_i,
        owner_user_id=owner_i,
    )


async def generate_template_preview(
    *,
    template_id: str,
    ctx: TemplateScopeContext,
    url: str | None,
    api_key: str | None,
    model: str | None,
) -> dict[str, Any]:
    """PPTX render when source archived; else layout previews using imported palette."""
    template = load_custom_template(template_id, ctx)
    if template is None:
        raise FileNotFoundError(f"template not found: {template_id}")

    from oaao_orchestrator.slide_project.template_pptx_preview import (
        try_regenerate_pptx_render_preview,
    )

    render_summary = try_regenerate_pptx_render_preview(template_id, ctx)
    if render_summary:
        pages = render_summary.get("pages") or []
        return {
            "ok": True,
            "preview_mode": "pptx_render",
            "template": load_custom_template(template_id, ctx),
            "pages": pages,
            "issues": [],
        }

    deck_style = template.get("deck_style") if isinstance(template.get("deck_style"), dict) else {}
    label = str(template.get("label") or template_id)
    profile = template.get("profile") if isinstance(template.get("profile"), dict) else {}
    profile_excerpt = json.dumps(profile, ensure_ascii=False)[:2500] if profile else ""
    specs = _preview_specs(template)
    html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
    pages: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []

    preview_root = _preview_root_for_row(template, template_id)
    preview_root.mkdir(parents=True, exist_ok=True)

    for spec in specs:
        idx = int(spec["index"])
        layout = str(spec.get("layout") or "title_content")
        slide_dir = preview_root / f"slides/{idx:02d}"
        slide_dir.mkdir(parents=True, exist_ok=True)

        slide_title = str(spec.get("title") or f"Slide {idx}")
        if spec.get("use_pptx_body") and spec.get("body_hint"):
            content_md = _markdown_from_pptx_text(
                slide_title,
                str(spec.get("body_hint") or ""),
                deck_label=label,
            )
        elif url and model:
            content_md = await generate_slide_markdown(
                url=url,
                api_key=api_key,
                model=model,
                deck_title=label,
                slide=spec,
                slide_dir=slide_dir,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Imported deck: {label}. Layout sample: {layout}. "
                            f"Echo the source deck tone; use zh-Hant when the import uses Chinese. "
                            f"Do not say 'dummy', 'preview', or 'placeholder'."
                        ),
                    }
                ],
                outline_excerpt=profile_excerpt or f"Template {template_id}",
                deck_style=deck_style,
            )
        else:
            if spec.get("body_hint") and layout == "title_hero":
                content_md = _markdown_from_pptx_text(
                    slide_title,
                    str(spec.get("body_hint") or ""),
                    deck_label=label,
                )
            else:
                content_md = _rich_fallback_markdown(
                    title=slide_title,
                    deck_title=label,
                    layout=layout,
                    idx=idx,
                    topic=label,
                )

        (slide_dir / "content.md").write_text(content_md, encoding="utf-8")
        html, ok, errors, attempts = await _generate_validated_slide_html(
            deck_title=label,
            spec=spec,
            content_md=content_md,
            base_url=url,
            api_key=api_key,
            model=model,
            html_retries=html_retries,
            slide_count=len(specs),
            deck_style=deck_style,
        )
        rel = f"slides/{idx:02d}/slide.html"
        slide_path = preview_slide_path(template_id, idx, template)
        _persist_slide_html(slide_path, html)
        layout_errors = validate_slide_layout(html) if ok else []
        verified = bool(ok) and len(layout_errors) == 0

        page_entry = {
            "index": idx,
            "title": str(spec.get("title") or f"Slide {idx}"),
            "layout": layout,
            "html_path": rel,
            "verified": verified,
            "validation_errors": [] if verified else (errors or layout_errors),
            "correction_attempts": attempts,
            "preview_url": _template_preview_html_api_path(template_id, idx),
        }
        pages.append(page_entry)
        if not verified:
            issues.append(page_entry)

    manifest = {
        "template_id": template_id,
        "slide_count": len(pages),
        "pages": pages,
    }
    save_preview_manifest(template_id, manifest, template)

    pages = _enrich_preview_pages(template_id, pages)
    issues = [p for p in pages if not p.get("verified")]
    manifest["pages"] = pages

    updated = update_template_fields(
        template_id,
        {
            "status": "preview",
            "preview_pages": pages,
            "preview_issues": issues,
        },
        ctx,
    )
    return {
        "ok": len(issues) == 0,
        "template": updated,
        "preview": manifest,
        "issues": issues,
    }


async def fix_template_preview_slide(
    *,
    template_id: str,
    slide_index: int,
    ctx: TemplateScopeContext,
    url: str | None,
    api_key: str | None,
    model: str | None,
) -> dict[str, Any]:
    """Re-run validate → LLM fix for one preview slide."""
    template, manifest = _load_manifest(template_id, ctx)
    page = next(
        (p for p in manifest.get("pages") or [] if int(p.get("index") or 0) == slide_index), None
    )
    if page is None:
        raise ValueError("preview_slide_not_found")

    layout = str(page.get("layout") or "title_content")
    theme = str(template.get("deck_theme") or template_id)
    deck_style = template.get("deck_style") if isinstance(template.get("deck_style"), dict) else {}
    spec = {
        "index": slide_index,
        "title": str(page.get("title") or f"Slide {slide_index}"),
        "layout": layout,
        "theme": theme,
    }
    preview_root = _preview_root_for_row(template, template_id)
    slide_dir = preview_root / f"slides/{slide_index:02d}"
    content_path = slide_dir / "content.md"
    if not content_path.is_file():
        raise FileNotFoundError("preview content.md missing")

    content_md = content_path.read_text(encoding="utf-8")
    html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
    initial_errors: list[str] = []
    slide_path = preview_slide_path(template_id, slide_index, template)
    if slide_path.is_file():
        _, initial_errors = validate_slide_html(slide_path.read_text(encoding="utf-8"))

    html, ok, errors, attempts = await _generate_validated_slide_html(
        deck_title=str(template.get("label") or template_id),
        spec=spec,
        content_md=content_md,
        base_url=url,
        api_key=api_key,
        model=model,
        html_retries=html_retries,
        slide_count=int(manifest.get("slide_count") or len(manifest.get("pages") or [])),
        deck_style=deck_style,
        initial_errors=initial_errors or None,
    )
    _persist_slide_html(slide_path, html)
    saved = slide_path.read_text(encoding="utf-8")
    ok, errors = validate_slide_html(saved)
    layout_errors = validate_slide_layout(saved) if ok else []
    verified = bool(ok) and len(layout_errors) == 0

    pages = []
    for p in manifest.get("pages") or []:
        if not isinstance(p, dict):
            continue
        row = dict(p)
        if int(row.get("index") or 0) == slide_index:
            row["verified"] = verified
            row["validation_errors"] = [] if verified else (errors or layout_errors)
            row["correction_attempts"] = attempts
            row["preview_url"] = _template_preview_html_api_path(template_id, slide_index)
        pages.append(row)

    pages = _enrich_preview_pages(template_id, pages)
    manifest["pages"] = pages
    save_preview_manifest(template_id, manifest, template)
    issues = [p for p in pages if not p.get("verified")]
    update_template_fields(template_id, {"preview_pages": pages, "preview_issues": issues}, ctx)

    page_row = next(p for p in pages if int(p.get("index") or 0) == slide_index)
    return {
        "ok": verified,
        "slide_index": slide_index,
        "verified": verified,
        "validation_errors": [] if verified else errors,
        "layout_warnings": layout_errors if not verified else [],
        "correction_attempts": attempts,
        "preview_url": page_row.get("preview_url"),
        "page": page_row,
    }


async def fix_all_template_previews(
    *,
    template_id: str,
    ctx: TemplateScopeContext,
    url: str | None,
    api_key: str | None,
    model: str | None,
) -> dict[str, Any]:
    template, manifest = _load_manifest(template_id, ctx)
    results: list[dict[str, Any]] = []
    for p in manifest.get("pages") or []:
        if not isinstance(p, dict):
            continue
        if p.get("verified"):
            continue
        idx = int(p.get("index") or 0)
        if idx < 1:
            continue
        results.append(
            await fix_template_preview_slide(
                template_id=template_id,
                slide_index=idx,
                ctx=ctx,
                url=url,
                api_key=api_key,
                model=model,
            )
        )
    template = load_custom_template(template_id, ctx)
    _, manifest = _load_manifest(template_id, ctx)
    issues = [
        p for p in manifest.get("pages") or [] if isinstance(p, dict) and not p.get("verified")
    ]
    pages = _enrich_preview_pages(
        template_id, [p for p in manifest.get("pages") or [] if isinstance(p, dict)]
    )
    return {
        "ok": len(issues) == 0,
        "template": template,
        "fixed": results,
        "issues": issues,
        "preview": {"pages": pages},
    }


async def publish_template(
    *,
    template_id: str,
    ctx: TemplateScopeContext,
    url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    auto_fix: bool = True,
) -> dict[str, Any]:
    """Verify all preview slides; optional fix pass; then status=published."""
    template, manifest = _load_manifest(template_id, ctx)  # noqa: RUF059
    pages = manifest.get("pages") or []
    if not pages:
        raise ValueError("preview_required_before_publish")

    if auto_fix and url and model:
        await fix_all_template_previews(
            template_id=template_id,
            ctx=ctx,
            url=url,
            api_key=api_key,
            model=model,
        )
        _, manifest = _load_manifest(template_id, ctx)
        pages = manifest.get("pages") or []

    unverified = [p for p in pages if isinstance(p, dict) and not p.get("verified")]
    if unverified:
        return {
            "ok": False,
            "error": "preview_slides_not_verified",
            "template_id": template_id,
            "issues": unverified,
        }

    updated = update_template_fields(
        template_id,
        {
            "status": "published",
            "preview_pages": _enrich_preview_pages(
                template_id, [p for p in pages if isinstance(p, dict)]
            ),
            "preview_issues": [],
        },
        ctx,
    )
    return {"ok": True, "template": updated, "published": True}


async def unpublish_template(
    *,
    template_id: str,
    ctx: TemplateScopeContext,
) -> dict[str, Any]:
    """Revert catalog visibility — status back to preview (not published)."""
    template, _manifest = _load_manifest(template_id, ctx)
    current = str(template.get("status") or "draft")
    if current != "published":
        return {"ok": True, "template": template, "published": False, "already_unpublished": True}

    updated = update_template_fields(
        template_id,
        {"status": "preview"},
        ctx,
    )
    return {"ok": True, "template": updated, "published": False}


async def delete_template(
    *,
    template_id: str,
    ctx: TemplateScopeContext,
) -> dict[str, Any]:
    """Permanently remove a user-imported custom template and its preview files."""
    delete_custom_template(template_id, ctx)
    return {"ok": True, "deleted": True, "template_id": template_id.strip()}
