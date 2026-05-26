"""W5-S1 phase 4 (slides) — slide-project + template-management endpoints.

Mounts:
- ``POST /v1/slides/slide_slots``
- ``POST /v1/slides/regenerate_slot``
- ``POST /v1/slides/regenerate_page``
- ``POST /v1/slides/verify_page``
- ``POST /v1/slides/templates/list``
- ``POST /v1/slides/template_analyze``
- ``GET  /v1/slides/template_import_job/{job_id}``
- ``POST /v1/slides/template_preview``
- ``POST /v1/slides/template_fix``
- ``POST /v1/slides/template_publish``
- ``POST /v1/slides/template_unpublish``
- ``POST /v1/slides/template_delete``

Heavy ``slide_project.*`` modules are imported lazily inside endpoint bodies to
keep import time low. All endpoints require the internal token via the shared
``require_internal_token`` dependency.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from oaao_orchestrator.routes._deps import require_internal_token
from oaao_orchestrator.routes._shared_models import EndpointPayload

if TYPE_CHECKING:  # pragma: no cover
    from oaao_orchestrator.slide_project.template_scope import TemplateScopeContext

logger = logging.getLogger("oaao_orchestrator.routes.slides")

router = APIRouter(tags=["slides"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class SlidePageRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None
    regen_markdown: bool = True


class SlideSlotsQuery(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    slide_designer: dict[str, Any] | None = None


class SlideRegenerateSlotRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    slot_id: str = Field(min_length=1, max_length=64)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None


class SlideVerifyRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None
    auto_fix: bool = True


class TemplateScopePayload(BaseModel):
    user_id: int = Field(ge=0)
    tenant_id: int | None = None
    is_platform_operator: bool = False


class TemplateAnalyzeRequest(BaseModel):
    pptx_path: str = Field(
        min_length=1, description="Absolute path to uploaded PPTX on shared volume"
    )
    endpoint: EndpointPayload | None = None
    label: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    persist: bool = True
    generate_preview: bool = True
    write_scope: str = Field(default="personal", pattern="^(global|tenant|personal)$")
    template_scope: TemplateScopePayload | None = None
    slide_designer: dict[str, Any] | None = None
    background: bool = Field(
        default=True,
        description="When true, return job_id immediately and run analyze in the background.",
    )


class TemplateWorkflowRequest(BaseModel):
    template_id: str = Field(min_length=1, max_length=64)
    endpoint: EndpointPayload | None = None
    slide_index: int | None = Field(default=None, ge=1, le=20)
    auto_fix: bool = True
    template_scope: TemplateScopePayload | None = None


class TemplateListRequest(BaseModel):
    published_only: bool = False
    scope_filter: str | None = Field(default=None, pattern="^(global|tenant|personal)$")
    template_scope: TemplateScopePayload | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _template_scope_ctx(body: TemplateScopePayload | None) -> TemplateScopeContext:
    from oaao_orchestrator.slide_project.template_scope import TemplateScopeContext

    return TemplateScopeContext.from_payload(body.model_dump() if body is not None else None)


def _resolve_api_key(ep: EndpointPayload | None) -> str | None:
    # Lazy import to avoid circular dep with app.py at module-import time.
    from oaao_orchestrator.endpoint_keys import resolve_api_key as _impl

    return _impl(ep)


async def _execute_template_analyze(body: TemplateAnalyzeRequest) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_analyzer import analyze_pptx_template
    from oaao_orchestrator.slide_project.template_scope import (
        can_write_scope,
        normalize_scope,
    )

    path = Path(body.pptx_path.strip())
    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    write_scope = normalize_scope(body.write_scope)
    if not can_write_scope(ctx, write_scope):
        raise PermissionError(f"cannot_write_scope:{write_scope}")

    result = await analyze_pptx_template(
        pptx_path=path,
        url=ep.base_url.strip() if ep and ep.base_url else None,
        api_key=_resolve_api_key(ep),
        model=ep.model.strip() if ep and ep.model else None,
        label=body.label,
        user_notes=body.notes,
        persist=bool(body.persist),
        ctx=ctx,
        write_scope=write_scope,
    )
    preview_payload: dict[str, Any] | None = None
    if body.generate_preview and isinstance(result.get("template_id"), str):
        tid = str(result["template_id"])
        preview_mode = str(result.get("preview_mode") or "").strip()
        if preview_mode != "pptx_render":
            from oaao_orchestrator.slide_project.pptx_render import pptx_render_available
            from oaao_orchestrator.slide_project.template_pptx_preview import (
                try_regenerate_pptx_render_preview,
            )

            if pptx_render_available():
                from oaao_orchestrator.slide_project.async_bridge import run_soffice_job

                try:
                    render_retry = await run_soffice_job(
                        try_regenerate_pptx_render_preview,
                        tid,
                        ctx,
                    )
                except Exception:
                    logger.exception("template_pptx_render_retry_failed template_id=%s", tid)
                    render_retry = None
                if render_retry:
                    preview_mode = "pptx_render"
                    result["preview_mode"] = "pptx_render"
                    result["thumbnail_source"] = "pptx_render"
                    result["preview_pages"] = render_retry.get("pages") or []
                    result["status"] = "preview"

        if preview_mode == "pptx_render":
            preview_payload = {
                "ok": True,
                "preview_mode": "pptx_render",
                "pages": result.get("preview_pages") or [],
            }
        else:
            from oaao_orchestrator.slide_project.pptx_render import pptx_render_available

            tools_ok = pptx_render_available()
            preview_payload = {
                "ok": False,
                "preview_mode": "render_unavailable",
                "pages": [],
                "render_unavailable": not tools_ok,
                "message": (
                    "PPTX slide render is not available in the orchestrator "
                    "(rebuild the orchestrator image with LibreOffice and poppler-utils, then re-import)."
                    if not tools_ok
                    else "PPTX slide render failed; check orchestrator logs. Re-import after fixing."
                ),
            }
    return {"ok": True, "template": result, "preview": preview_payload}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/v1/slides/slide_slots")
async def slide_slots(
    body: SlideSlotsQuery,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.regenerate import get_slide_slots

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return get_slide_slots(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            storage_root=storage_root,
        )
    except Exception as exc:
        logger.exception(
            "slide_slots_failed project_id=%s page=%s", body.project_id, body.slide_index
        )
        raise HTTPException(status_code=500, detail="slide_slots_failed") from exc


@router.post("/v1/slides/regenerate_slot")
async def slide_regenerate_slot(
    body: SlideRegenerateSlotRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.regenerate import regenerate_slide_slot

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return await regenerate_slide_slot(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            slot_id=body.slot_id.strip(),
            conversation_id=body.conversation_id,
            user_id=body.user_id,
            endpoint=body.endpoint.model_dump(),
            messages=list(body.messages or []),
            storage_root=storage_root,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "slide_regenerate_slot_failed project_id=%s page=%s slot=%s",
            body.project_id,
            body.slide_index,
            body.slot_id,
        )
        raise HTTPException(status_code=500, detail="slide_regenerate_slot_failed") from exc


@router.post("/v1/slides/regenerate_page")
async def slide_regenerate_page(
    body: SlidePageRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.regenerate import regenerate_slide_page

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return await regenerate_slide_page(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            conversation_id=body.conversation_id,
            user_id=body.user_id,
            endpoint=body.endpoint.model_dump(),
            messages=list(body.messages or []),
            storage_root=storage_root,
            regen_markdown=bool(body.regen_markdown),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "slide_regenerate_failed project_id=%s page=%s", body.project_id, body.slide_index
        )
        raise HTTPException(status_code=500, detail="slide_regenerate_failed") from exc


@router.post("/v1/slides/verify_page")
async def slide_verify_page(
    body: SlideVerifyRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.regenerate import (
        verify_and_fix_slide_page,
        verify_slide_page_html,
    )

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    if body.auto_fix and body.endpoint is not None:
        try:
            return await verify_and_fix_slide_page(
                project_id=body.project_id.strip(),
                slide_index=body.slide_index,
                conversation_id=body.conversation_id,
                user_id=body.user_id,
                endpoint=body.endpoint.model_dump(),
                messages=list(body.messages or []),
                storage_root=storage_root,
                auto_fix=True,
            )
        except Exception as exc:
            logger.exception(
                "slide_verify_fix_failed project_id=%s page=%s",
                body.project_id,
                body.slide_index,
            )
            raise HTTPException(status_code=500, detail="slide_verify_fix_failed") from exc
    return await verify_slide_page_html(
        project_id=body.project_id.strip(),
        slide_index=body.slide_index,
        storage_root=storage_root,
    )


@router.post("/v1/slides/templates/list")
async def slide_templates_list(
    body: TemplateListRequest | None = None,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.custom_templates import list_custom_templates
    from oaao_orchestrator.slide_project.pptx_render import pptx_render_available
    from oaao_orchestrator.slide_project.template_registry import (
        catalog_version,
        layout_ids,
        themes_data,
    )
    from oaao_orchestrator.slide_project.template_scope import normalize_scope

    themes = themes_data().get("themes")
    builtin_themes = sorted(themes.keys()) if isinstance(themes, dict) else []
    published_only = bool(body.published_only) if body is not None else False
    ctx = _template_scope_ctx(body.template_scope if body is not None else None)
    scope_filter = None
    if body is not None and body.scope_filter:
        scope_filter = normalize_scope(body.scope_filter)

    return {
        "catalog_version": catalog_version(),
        "builtin_themes": builtin_themes,
        "builtin_layouts": sorted(layout_ids()),
        "pptx_render_available": pptx_render_available(),
        "custom_templates": list_custom_templates(
            ctx,
            published_only=published_only,
            scope_filter=scope_filter,
        ),
        "scope_capabilities": {
            "can_write_global": False,
            "can_write_tenant": bool(
                ctx.is_tenant_admin and ctx.tenant_id is not None and ctx.tenant_id > 0
            ),
            "can_write_personal": ctx.user_id > 0,
        },
    }


@router.post("/v1/slides/template_analyze")
async def slide_template_analyze(
    body: TemplateAnalyzeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """Analyze uploaded PPTX → custom template JSON (theme + deck_style)."""
    if body.background:
        from oaao_orchestrator.slide_project.template_import_jobs import (
            start_template_import_job,
        )

        job_id = await start_template_import_job(lambda: _execute_template_analyze(body))
        return {"ok": True, "job_id": job_id, "status": "running"}

    try:
        return await _execute_template_analyze(body)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_analyze_failed path=%s", body.pptx_path)
        raise HTTPException(status_code=500, detail="slide_template_analyze_failed") from exc


@router.get("/v1/slides/template_import_job/{job_id}")
async def slide_template_import_job(
    job_id: str,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_import_jobs import get_template_import_job

    job = await get_template_import_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="template_import_job_not_found")
    if job.status == "running":
        return {"ok": True, "job_id": job.job_id, "status": "running"}
    if job.status == "failed":
        return {
            "ok": False,
            "job_id": job.job_id,
            "status": "failed",
            "detail": job.error or "slide_template_analyze_failed",
        }
    return {"ok": True, "job_id": job.job_id, "status": "done", **(job.result or {})}


@router.post("/v1/slides/template_preview")
async def slide_template_preview(
    body: TemplateWorkflowRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_preview import generate_template_preview

    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await generate_template_preview(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=ep.base_url.strip() if ep and ep.base_url else None,
            api_key=_resolve_api_key(ep),
            model=ep.model.strip() if ep and ep.model else None,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_preview_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_preview_failed") from exc


@router.post("/v1/slides/template_fix")
async def slide_template_fix(
    body: TemplateWorkflowRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_preview import (
        fix_all_template_previews,
        fix_template_preview_slide,
    )

    ep = body.endpoint
    url = ep.base_url.strip() if ep and ep.base_url else None
    key = _resolve_api_key(ep)
    model = ep.model.strip() if ep and ep.model else None
    ctx = _template_scope_ctx(body.template_scope)
    try:
        if body.slide_index is not None:
            return await fix_template_preview_slide(
                template_id=body.template_id.strip(),
                slide_index=int(body.slide_index),
                ctx=ctx,
                url=url,
                api_key=key,
                model=model,
            )
        return await fix_all_template_previews(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=url,
            api_key=key,
            model=model,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_fix_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_fix_failed") from exc


@router.post("/v1/slides/template_publish")
async def slide_template_publish(
    body: TemplateWorkflowRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_preview import publish_template

    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await publish_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=ep.base_url.strip() if ep and ep.base_url else None,
            api_key=_resolve_api_key(ep),
            model=ep.model.strip() if ep and ep.model else None,
            auto_fix=bool(body.auto_fix),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_publish_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_publish_failed") from exc


@router.post("/v1/slides/template_unpublish")
async def slide_template_unpublish(
    body: TemplateWorkflowRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_preview import unpublish_template

    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await unpublish_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_unpublish_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_unpublish_failed") from exc


@router.post("/v1/slides/template_delete")
async def slide_template_delete(
    body: TemplateWorkflowRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_preview import delete_template

    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await delete_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("slide_template_delete_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_delete_failed") from exc
