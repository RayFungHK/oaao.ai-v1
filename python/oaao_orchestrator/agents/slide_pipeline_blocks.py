"""Pipeline UI blocks for slide designer (SD-2 preview strip, SD-3 iframe URLs)."""

from __future__ import annotations

from typing import Any


def _slide_indices(manifest: dict[str, Any]) -> tuple[int, dict[int, dict[str, Any]], dict[int, dict[str, Any]]]:
    """Return (total, pages_by_index, spec_by_index)."""
    total = int(manifest.get("slide_count") or 0)
    pages_by_index: dict[int, dict[str, Any]] = {}
    for raw in manifest.get("pages") or []:
        if not isinstance(raw, dict):
            continue
        try:
            idx = int(raw.get("index") or 0)
        except (TypeError, ValueError):
            continue
        if idx > 0:
            pages_by_index[idx] = raw

    spec_by_index: dict[int, dict[str, Any]] = {}
    for raw in manifest.get("slides_spec") or []:
        if not isinstance(raw, dict):
            continue
        try:
            idx = int(raw.get("index") or 0)
        except (TypeError, ValueError):
            continue
        if idx > 0:
            spec_by_index[idx] = raw

    if total < 1:
        total = max(
            (max(pages_by_index) if pages_by_index else 0),
            (max(spec_by_index) if spec_by_index else 0),
            0,
        )
    if total < 1 and (pages_by_index or spec_by_index):
        total = max(len(pages_by_index), len(spec_by_index))

    return total, pages_by_index, spec_by_index


def _preview_url_for(project_id: str, slide_index: int, conversation_id: Any) -> str:
    from oaao_orchestrator.slide_project.store import _slide_html_api_path

    cid = str(conversation_id).strip() if conversation_id is not None else ""
    return _slide_html_api_path(project_id, slide_index, cid or None)


def _page_is_ready(page: dict[str, Any] | None) -> bool:
    if not isinstance(page, dict):
        return False
    if page.get("has_html") is True:
        return True
    html_path = str(page.get("html_path") or "").strip()
    return html_path.endswith("slide.html") or html_path.endswith(".html")


def build_slide_preview_rows(manifest: dict[str, Any] | None) -> tuple[str, int, list[dict[str, Any]]]:
    """Build preview strip rows from manifest pages + slides_spec (never hardcoded stubs)."""
    m = manifest if isinstance(manifest, dict) else {}
    project_id = str(m.get("project_id") or "").strip()
    project_title = str(m.get("title") or "Slide deck").strip() or "Slide deck"
    total, pages_by_index, spec_by_index = _slide_indices(m)

    indices: set[int] = set(spec_by_index.keys()) | set(pages_by_index.keys())
    if not indices and total > 0:
        indices = set(range(1, total + 1))

    slides: list[dict[str, Any]] = []
    for idx in sorted(indices):
        if total > 0 and idx > total:
            continue
        page = pages_by_index.get(idx)
        spec = spec_by_index.get(idx, {})
        title = str((page or {}).get("title") or spec.get("title") or f"Slide {idx}").strip()
        preview_url = (page or {}).get("preview_url") if isinstance(page, dict) else None
        if not preview_url and project_id:
            preview_url = _preview_url_for(project_id, idx, m.get("conversation_id"))
        row_total = total if total > 0 else max(len(indices), idx)
        slides.append(
            {
                "index": idx,
                "total": row_total,
                "title": title or f"Slide {idx}",
                "preview_kind": str((page or spec).get("theme") or "default"),
                "preview_url": preview_url,
                "status": "ready" if _page_is_ready(page) else "building",
            }
        )

    if total < 1 and slides:
        total = max(int(s.get("index") or 0) for s in slides)
    return project_title, total, slides


def build_slide_preview_strip_block(
    *,
    run_task_id: str,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Slide cards — real preview_url from on-disk project when manifest is provided."""

    project_title, total, slides = build_slide_preview_rows(manifest)
    m = manifest if isinstance(manifest, dict) else {}

    log_name = "export_ppt_fix.log"
    deck_artifact: dict[str, Any] | None = None
    for f in m.get("files") or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        if not name:
            continue
        if name == log_name:
            log_name = name
        if name.lower().endswith(".pptx") and deck_artifact is None:
            deck_artifact = {
                "filename": name,
                "size_bytes": f.get("size_bytes"),
                "mime": f.get("mime")
                or "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            }

    props: dict[str, Any] = {
        "run_task_id": run_task_id,
        "project_id": m.get("project_id"),
        "project_title": project_title,
        "slide_count": total,
        "slides": slides,
        "material_thumb": {
            "material_id": f"mat-sandbox-{run_task_id}",
            "title": log_name.replace(".log", ""),
            "category": "code",
            "snippet": "ubuntu@sandbox:~$",
        },
    }
    if deck_artifact:
        props["deck_artifact"] = deck_artifact

    return {
        "type": "slide_preview_strip",
        "zone": "after",
        "title": "Slide previews",
        "props": props,
    }
