"""Regenerate / verify-fix slide pages — validate → LLM retry loop until tests pass."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html, validate_slide_layout
from oaao_orchestrator.slide_project.llm import generate_slide_html, generate_slide_markdown
from oaao_orchestrator.slide_project.store import SlideProjectStore, _env_int

logger = logging.getLogger(__name__)


def _resolve_api_key(api_key_env: str | None) -> str | None:
    name = (api_key_env or "").strip()
    if not name:
        return os.environ.get("OPENAI_API_KEY")
    return os.environ.get(name)


async def _generate_validated_slide_html(
    *,
    deck_title: str,
    spec: dict[str, Any],
    content_md: str,
    base_url: str | None,
    api_key: str | None,
    model: str | None,
    html_retries: int,
    slide_count: int = 10,
    deck_style: dict[str, Any] | None = None,
    initial_errors: list[str] | None = None,
    project_dir: Path | None = None,
) -> tuple[str, bool, list[str], int]:
    """
    Code-verify loop: generate HTML, run sandbox tests, feed errors back to LLM until pass.
    Returns (html, ok, validation_errors, attempts_used).
    """
    from oaao_orchestrator.slide_project.store import _fallback_slide_html

    idx = int(spec.get("index") or 1)
    errors: list[str] = list(initial_errors or [])
    html = ""
    attempts = 0
    for attempt in range(1, html_retries + 1):
        attempts = attempt
        html = await generate_slide_html(
            url=base_url or None,
            api_key=api_key,
            model=model or None,
            deck_title=deck_title,
            slide=spec,
            content_md=content_md,
            prior_errors=errors or None,
            slide_count=slide_count,
            deck_style=deck_style,
            project_dir=project_dir,
        )
        ok, errors = validate_slide_html(html)
        if ok:
            return html, True, [], attempts

    if not html or errors:
        html = _fallback_slide_html(
            title=str(spec.get("title") or f"Slide {idx}"),
            subtitle=content_md[:180].replace("\n", " ").replace("```", ""),
            theme=str(spec.get("theme") or "default"),
            spec=spec,
            content_md=content_md,
            deck_title=deck_title,
            slide_count=slide_count,
            deck_style=deck_style,
        )
        ok, errors = validate_slide_html(html)
        attempts = max(attempts, 1)

    return html, bool(ok), errors, attempts


def _finalize_saved_slide(
    *,
    slide_path: Path,
    html: str,
    ok: bool,
    errors: list[str],
    spec: dict[str, Any],
    content_md: str,
    deck_title: str = "",
    slide_count: int = 10,
    deck_style: dict[str, Any] | None = None,
) -> tuple[str, bool, list[str], list[str]]:
    """Persist normalized HTML and re-validate on disk."""
    from oaao_orchestrator.slide_project.store import (
        _fallback_slide_html,
        _persist_slide_html,
    )

    idx = int(spec.get("index") or 1)
    _persist_slide_html(slide_path, html)
    saved_html = slide_path.read_text(encoding="utf-8")
    ok, errors = validate_slide_html(saved_html)
    if ok:
        return saved_html, True, [], []

    html = _fallback_slide_html(
        title=str(spec.get("title") or f"Slide {idx}"),
        subtitle=content_md[:180].replace("\n", " ").replace("```", ""),
        theme=str(spec.get("theme") or "default"),
        spec=spec,
        content_md=content_md,
        deck_title=deck_title,
        slide_count=slide_count,
        deck_style=deck_style,
    )
    _persist_slide_html(slide_path, html)
    saved_html = slide_path.read_text(encoding="utf-8")
    ok, errors = validate_slide_html(saved_html)
    layout_errors = validate_slide_layout(saved_html) if saved_html else errors
    layout_ok = len(layout_errors) == 0
    return saved_html, bool(ok) or layout_ok, ([] if (ok or layout_ok) else errors), layout_errors


async def get_slide_slots(
    *,
    project_id: str,
    slide_index: int,
    storage_root: str | None = None,
) -> dict[str, Any]:
    """Return layout slot definitions and saved slot bodies for one deck slide."""
    from oaao_orchestrator.slide_project.layouts import infer_layout
    from oaao_orchestrator.slide_project.slot_content import layout_slot_defs

    root = (
        Path(storage_root.strip())
        if isinstance(storage_root, str) and storage_root.strip()
        else None
    )
    store = SlideProjectStore(root=root)
    pid = project_id.strip()
    idx = max(1, int(slide_index))
    manifest = store.load_manifest(pid)
    spec = None
    for row in manifest.get("slides_spec") or []:
        if isinstance(row, dict) and int(row.get("index") or 0) == idx:
            spec = dict(row)
            break
    if spec is None:
        for row in manifest.get("pages") or []:
            if isinstance(row, dict) and int(row.get("index") or 0) == idx:
                spec = {"index": idx, "title": row.get("title"), "theme": row.get("theme")}
                break
    if spec is None:
        return {"ok": False, "error": "slide_not_in_outline", "slide_index": idx}

    layout = str(spec.get("layout") or "").strip() or infer_layout(spec)
    defs = layout_slot_defs(layout, spec)
    slide_dir = store.project_dir(pid) / f"slides/{idx:02d}"
    saved: dict[str, str] = {}
    slots_path = slide_dir / "slots.json"
    if slots_path.is_file():
        try:
            import json

            raw = json.loads(slots_path.read_text(encoding="utf-8"))
            if isinstance(raw.get("slots"), dict):
                saved = {str(k): str(v) for k, v in raw["slots"].items()}
        except (OSError, json.JSONDecodeError):
            pass

    slots_out: list[dict[str, Any]] = []
    for row in defs:
        sid = str(row.get("id") or "")
        body = saved.get(sid, "")
        preview = body.replace("\n", " ")[:160] if body else ""
        spec_seeds = spec.get("slot_seeds") if isinstance(spec.get("slot_seeds"), dict) else {}
        seed_preview = ""
        if isinstance(spec_seeds, dict) and sid in spec_seeds:
            seed_preview = str(spec_seeds[sid] or "").replace("\n", " ")[:160]
        slots_out.append(
            {
                "id": sid,
                "label": str(row.get("label") or sid),
                "kind": str(row.get("kind") or "bullets"),
                "recipe": str(row.get("recipe") or ""),
                "has_content": bool(body.strip()),
                "preview": preview or seed_preview,
                "has_seed": bool(seed_preview),
            }
        )

    return {
        "ok": True,
        "slide_index": idx,
        "project_id": pid,
        "layout": layout,
        "slot_content_enabled": True,
        "slots": slots_out,
        "has_slots_json": slots_path.is_file(),
    }


async def regenerate_slide_slot(
    *,
    project_id: str,
    slide_index: int,
    slot_id: str,
    conversation_id: str | None,
    user_id: str | None,
    endpoint: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    storage_root: str | None = None,
) -> dict[str, Any]:
    """Regenerate one content slot, re-merge markdown, rebuild HTML."""
    from oaao_orchestrator.slide_project.slot_content import (
        layout_has_slots,
        regenerate_slot_content,
    )

    root = (
        Path(storage_root.strip())
        if isinstance(storage_root, str) and storage_root.strip()
        else None
    )
    store = SlideProjectStore(root=root)
    pid = project_id.strip()
    idx = max(1, int(slide_index))
    sid = (slot_id or "").strip()
    if not sid:
        raise ValueError("slot_id required")

    msgs = list(messages or [])
    base_url = str(endpoint.get("base_url") or "").strip()
    model = str(endpoint.get("model") or "").strip()
    api_key = _resolve_api_key(
        str(endpoint.get("api_key_env") or "") if endpoint.get("api_key_env") else None
    )

    session = await store.open_build_session(
        conversation_id=conversation_id,
        assistant_message_id=None,
        user_id=user_id,
        workspace_id=None,
        run_task_id=f"regen-slot-{idx}-{sid}",
        resume_project_id=pid,
        title=None,
    )
    session.hydrate_from_disk()
    spec = next(
        (s for s in session.slides_spec if int(s.get("index") or 0) == idx),
        None,
    )
    if spec is None:
        return {"ok": False, "error": "slide_not_in_outline", "slide_index": idx}

    from oaao_orchestrator.slide_project.layouts import infer_layout

    layout = str(spec.get("layout") or "").strip() or infer_layout(spec)
    if not layout_has_slots(layout):
        return {"ok": False, "error": "layout_has_no_slots", "slide_index": idx, "layout": layout}

    if not session.deck_style:
        await session.phase_deck_style(
            messages=msgs,
            llm_url=base_url or None,
            llm_api_key=api_key,
            llm_model=model or None,
        )

    slide_dir = session.proj_dir / f"slides/{idx:02d}"
    slide_dir.mkdir(parents=True, exist_ok=True)

    try:
        content_md, slot_values = await regenerate_slot_content(
            url=base_url or None,
            api_key=api_key,
            model=model or None,
            deck_title=session.deck_title,
            slide=spec,
            slot_id=sid,
            messages=msgs,
            outline_excerpt=session.outline_body,
            deck_style=session.deck_style,
            slide_dir=slide_dir,
        )
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "slide_index": idx, "slot_id": sid}

    html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
    html, ok, errors, attempts = await _generate_validated_slide_html(
        deck_title=session.deck_title,
        spec=spec,
        content_md=content_md,
        base_url=base_url or None,
        api_key=api_key,
        model=model or None,
        html_retries=html_retries,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
        project_dir=session.proj_dir,
    )

    rel = f"slides/{idx:02d}/slide.html"
    slide_path = session.proj_dir / rel
    saved_html, ok, errors, layout_errors = _finalize_saved_slide(  # noqa: RUF059
        slide_path=slide_path,
        html=html,
        ok=ok,
        errors=errors,
        spec=spec,
        content_md=content_md,
        deck_title=session.deck_title,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
    )

    result = await _package_slide_page_result(
        store=store,
        session=session,
        spec=spec,
        idx=idx,
        rel=rel,
        conversation_id=conversation_id,
        ok=ok,
        errors=errors,
        layout_errors=layout_errors,
        attempts=attempts,
        fixed=True,
        mode="regenerate_slot",
    )
    result["slot_id"] = sid
    result["slots"] = slot_values
    return result


async def regenerate_slide_page(
    *,
    project_id: str,
    slide_index: int,
    conversation_id: str | None,
    user_id: str | None,
    endpoint: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    storage_root: str | None = None,
    regen_markdown: bool = True,
) -> dict[str, Any]:
    """Rebuild one slide (markdown + HTML by default) with validate → LLM retry loop."""
    root = (
        Path(storage_root.strip())
        if isinstance(storage_root, str) and storage_root.strip()
        else None
    )
    store = SlideProjectStore(root=root)
    pid = project_id.strip()
    idx = max(1, int(slide_index))
    msgs = list(messages or [])

    base_url = str(endpoint.get("base_url") or "").strip()
    model = str(endpoint.get("model") or "").strip()
    api_key = _resolve_api_key(
        str(endpoint.get("api_key_env") or "") if endpoint.get("api_key_env") else None
    )

    session = await store.open_build_session(
        conversation_id=conversation_id,
        assistant_message_id=None,
        user_id=user_id,
        workspace_id=None,
        run_task_id=f"regen-{idx}",
        resume_project_id=pid,
        title=None,
    )
    session.hydrate_from_disk()
    spec = next(
        (s for s in session.slides_spec if int(s.get("index") or 0) == idx),
        None,
    )
    if spec is None:
        return {"ok": False, "error": "slide_not_in_outline", "slide_index": idx}

    if not session.deck_style:
        await session.phase_deck_style(
            messages=msgs,
            llm_url=base_url or None,
            llm_api_key=api_key,
            llm_model=model or None,
        )

    slide_dir = session.proj_dir / f"slides/{idx:02d}"
    slide_dir.mkdir(parents=True, exist_ok=True)

    if regen_markdown:
        content_md = await generate_slide_markdown(
            url=base_url or None,
            api_key=api_key,
            model=model or None,
            deck_title=session.deck_title,
            slide=spec,
            messages=msgs,
            outline_excerpt=session.outline_body,
            deck_style=session.deck_style,
            slide_dir=slide_dir,
        )
        (slide_dir / "content.md").write_text(content_md, encoding="utf-8")
    elif not (slide_dir / "content.md").is_file():
        return {"ok": False, "error": "missing_content_md", "slide_index": idx}

    content_md = (slide_dir / "content.md").read_text(encoding="utf-8")
    html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
    html, ok, errors, attempts = await _generate_validated_slide_html(
        deck_title=session.deck_title,
        spec=spec,
        content_md=content_md,
        base_url=base_url or None,
        api_key=api_key,
        model=model or None,
        html_retries=html_retries,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
        project_dir=session.proj_dir,
    )

    rel = f"slides/{idx:02d}/slide.html"
    slide_path = session.proj_dir / rel
    saved_html, ok, errors, layout_errors = _finalize_saved_slide(  # noqa: RUF059
        slide_path=slide_path,
        html=html,
        ok=ok,
        errors=errors,
        spec=spec,
        content_md=content_md,
        deck_title=session.deck_title,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
    )

    return await _package_slide_page_result(
        store=store,
        session=session,
        spec=spec,
        idx=idx,
        rel=rel,
        conversation_id=conversation_id,
        ok=ok,
        errors=errors,
        layout_errors=layout_errors,
        attempts=attempts,
        fixed=True,
        mode="regenerate",
    )


async def verify_and_fix_slide_page(
    *,
    project_id: str,
    slide_index: int,
    conversation_id: str | None,
    user_id: str | None,
    endpoint: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    storage_root: str | None = None,
    auto_fix: bool = True,
) -> dict[str, Any]:
    """
    Code verify — run sandbox tests; on failure feed errors to LLM and retry until verified.
    Does not regenerate markdown unless missing.
    """
    root = (
        Path(storage_root.strip())
        if isinstance(storage_root, str) and storage_root.strip()
        else None
    )
    store = SlideProjectStore(root=root)
    pid = project_id.strip()
    idx = max(1, int(slide_index))

    base_url = str(endpoint.get("base_url") or "").strip()
    model = str(endpoint.get("model") or "").strip()
    api_key = _resolve_api_key(
        str(endpoint.get("api_key_env") or "") if endpoint.get("api_key_env") else None
    )
    if auto_fix and (not base_url or not model):
        return {
            "ok": False,
            "error": "endpoint_required_for_verify_fix",
            "slide_index": idx,
            "project_id": pid,
        }

    session = await store.open_build_session(
        conversation_id=conversation_id,
        assistant_message_id=None,
        user_id=user_id,
        workspace_id=None,
        run_task_id=f"verify-{idx}",
        resume_project_id=pid,
        title=None,
    )
    session.hydrate_from_disk()
    spec = next(
        (s for s in session.slides_spec if int(s.get("index") or 0) == idx),
        None,
    )
    if spec is None:
        return {"ok": False, "error": "slide_not_in_outline", "slide_index": idx}

    slide_dir = session.proj_dir / f"slides/{idx:02d}"
    rel = f"slides/{idx:02d}/slide.html"
    slide_path = session.proj_dir / rel
    manifest = store.load_manifest(pid) or {}
    for p in manifest.get("pages") or []:
        if (
            isinstance(p, dict)
            and int(p.get("index") or 0) == idx
            and isinstance(p.get("html_path"), str)
        ):
            rel = str(p["html_path"]).strip() or rel
            slide_path = session.proj_dir / rel
            break

    if not slide_path.is_file():
        return {"ok": False, "error": "slide_html_missing", "slide_index": idx, "project_id": pid}

    content_path = slide_dir / "content.md"
    if not content_path.is_file():
        return {"ok": False, "error": "missing_content_md", "slide_index": idx, "project_id": pid}

    content_md = content_path.read_text(encoding="utf-8")
    saved_html = slide_path.read_text(encoding="utf-8")
    ok, errors = validate_slide_html(saved_html)

    if ok:
        return await _package_slide_page_result(
            store=store,
            session=session,
            spec=spec,
            idx=idx,
            rel=rel,
            conversation_id=conversation_id,
            ok=True,
            errors=[],
            layout_errors=[],
            attempts=0,
            fixed=False,
            mode="verify",
        )

    if not auto_fix:
        return {
            "ok": False,
            "slide_index": idx,
            "project_id": pid,
            "validation_errors": errors,
            "verified": False,
        }

    html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
    if not session.deck_style:
        await session.phase_deck_style(
            messages=list(messages or []),
            llm_url=base_url or None,
            llm_api_key=api_key,
            llm_model=model or None,
        )

    html, ok, errors, attempts = await _generate_validated_slide_html(
        deck_title=session.deck_title,
        spec=spec,
        content_md=content_md,
        base_url=base_url or None,
        api_key=api_key,
        model=model or None,
        html_retries=html_retries,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
        initial_errors=errors,
    )
    saved_html, ok, errors, layout_errors = _finalize_saved_slide(
        slide_path=slide_path,
        html=html,
        ok=ok,
        errors=errors,
        spec=spec,
        content_md=content_md,
        deck_title=session.deck_title,
        slide_count=session.slide_count,
        deck_style=session.deck_style,
    )

    return await _package_slide_page_result(
        store=store,
        session=session,
        spec=spec,
        idx=idx,
        rel=rel,
        conversation_id=conversation_id,
        ok=ok,
        errors=errors,
        layout_errors=layout_errors,
        attempts=attempts,
        fixed=True,
        mode="verify",
    )


async def _package_slide_page_result(
    *,
    store: SlideProjectStore,
    session: Any,
    spec: dict[str, Any],
    idx: int,
    rel: str,
    conversation_id: str | None,
    ok: bool,
    errors: list[str],
    layout_errors: list[str],
    attempts: int,
    fixed: bool,
    mode: str,
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.store import _slide_html_api_path

    cid = str(conversation_id).strip() if conversation_id else ""
    page_entry = {
        "index": idx,
        "title": str(spec.get("title") or f"Slide {idx}"),
        "html_path": rel,
        "preview_url": _slide_html_api_path(session.project_id, idx, cid or None),
        "theme": str(spec.get("theme") or "default"),
        "has_markdown": True,
        "has_html": True,
    }
    await store.merge_manifest_page(session.project_id, page_entry)

    layout_ok = len(layout_errors) == 0
    verified = bool(ok) or layout_ok
    return {
        "ok": verified,
        "verified": verified,
        "slide_index": idx,
        "project_id": session.project_id,
        "preview_url": page_entry.get("preview_url"),
        "validation_errors": [] if verified else errors,
        "layout_warnings": layout_errors if (not ok and layout_ok) else [],
        "correction_attempts": attempts,
        "fixed": fixed,
        "mode": mode,
        "page": page_entry,
    }


async def verify_slide_page_html(
    *,
    project_id: str,
    slide_index: int,
    storage_root: str | None = None,
) -> dict[str, Any]:
    """Read slide.html from disk and run sandbox + layout validation (no LLM)."""
    root = (
        Path(storage_root.strip())
        if isinstance(storage_root, str) and storage_root.strip()
        else None
    )
    store = SlideProjectStore(root=root)
    pid = project_id.strip()
    idx = max(1, int(slide_index))
    manifest = store.load_manifest(pid)
    rel = f"slides/{idx:02d}/slide.html"
    for p in manifest.get("pages") or []:
        if (
            isinstance(p, dict)
            and int(p.get("index") or 0) == idx
            and isinstance(p.get("html_path"), str)
        ):
            rel = str(p["html_path"]).strip() or rel
            break
    path = store.project_dir(pid) / rel
    if not path.is_file():
        return {"ok": False, "error": "slide_html_missing", "slide_index": idx, "verified": False}
    html = path.read_text(encoding="utf-8")
    ok, errors = validate_slide_html(html)
    return {
        "ok": ok,
        "verified": ok,
        "slide_index": idx,
        "project_id": pid,
        "validation_errors": errors,
        "correction_attempts": 0,
        "fixed": False,
    }
