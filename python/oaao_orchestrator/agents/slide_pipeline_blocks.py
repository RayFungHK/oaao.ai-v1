"""Pipeline UI blocks for slide designer (SD-2 preview strip, SD-3 iframe URLs)."""

from __future__ import annotations

from typing import Any


def build_slide_preview_strip_block(
    *,
    run_task_id: str,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Slide cards — real preview_url from on-disk project when manifest is provided."""

    total = int((manifest or {}).get("slide_count") or 12)
    project_title = str((manifest or {}).get("title") or "OAAO AI 平台管理層簡報")
    pages = (manifest or {}).get("pages") if isinstance(manifest, dict) else None

    slides: list[dict[str, Any]] = []
    if isinstance(pages, list) and pages:
        for p in pages:
            if not isinstance(p, dict):
                continue
            idx = int(p.get("index") or 0) or 1
            slides.append(
                {
                    "index": idx,
                    "total": total,
                    "title": str(p.get("title") or f"Slide {idx}"),
                    "preview_kind": str(p.get("theme") or "executive_problem"),
                    "preview_url": p.get("preview_url"),
                    "status": "ready",
                }
            )
    else:
        slides = [
            {
                "index": 2,
                "total": total,
                "title": "為什麼現在需要這個平台",
                "preview_kind": "executive_problem",
                "status": "ready",
            },
            {
                "index": 3,
                "total": total,
                "title": "OAAO 的定位很明確",
                "preview_kind": "platform_layers",
                "status": "ready",
            },
        ]

    log_name = "export_ppt_fix.log"
    deck_artifact: dict[str, Any] | None = None
    for f in (manifest or {}).get("files") or []:
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
        "project_id": (manifest or {}).get("project_id"),
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
