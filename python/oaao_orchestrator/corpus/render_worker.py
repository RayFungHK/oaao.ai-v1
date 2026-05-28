"""CS-1-S13 — Corpus render (HTML fill + PDF + optional LLM parameters)."""

from __future__ import annotations

from typing import Any

import httpx

from oaao_orchestrator.corpus.html_template import (
    build_html_template_v1,
    get_html_template_from_style,
    render_html_document,
    render_pdf_from_html,
)


async def _resolve_parameters(payload: dict[str, Any], template: dict[str, Any]) -> dict[str, str]:
    raw_params = payload.get("parameters")
    parameters: dict[str, str] = {}
    if isinstance(raw_params, dict):
        parameters = {str(k): str(v) for k, v in raw_params.items()}

    brief = str(payload.get("brief") or "").strip()
    if brief and not parameters.get("table_rows"):
        parameters.setdefault("brief", brief)
    llm_cfg = payload.get("llm_cfg")
    if brief and isinstance(llm_cfg, dict) and llm_cfg.get("base_url") and llm_cfg.get("model"):
        from oaao_orchestrator.corpus.llm import fill_template_parameters_llm

        async with httpx.AsyncClient() as client:
            filled = await fill_template_parameters_llm(
                client,
                llm_cfg=llm_cfg,
                brief=brief,
                profile_name=str(payload.get("profile_name") or ""),
                template=template,
            )
        for k, v in filled.items():
            if v and (k not in parameters or not parameters[k]):
                parameters[k] = v
    return parameters


async def run_corpus_template_build(payload: dict[str, Any]) -> dict[str, Any]:
    segments = payload.get("segments")
    if not isinstance(segments, list) or not segments:
        return {"ok": False, "error": "segments_required", "detail": "Provide analyzed segments[]"}

    blueprint = payload.get("structure_blueprint")
    if not isinstance(blueprint, dict):
        blueprint = None

    template = build_html_template_v1(
        segments=segments,
        structure_blueprint=blueprint,
        profile_name=str(payload.get("profile_name") or ""),
    )
    style_json = payload.get("style_json")
    if isinstance(style_json, dict):
        from oaao_orchestrator.corpus.html_template import attach_html_template_to_style_json

        attach_html_template_to_style_json(style_json, template)

    return {
        "ok": True,
        "html_template": template,
        "style_json": style_json if isinstance(style_json, dict) else None,
        "parameter_count": len(template.get("parameters") or []),
    }


async def run_corpus_render(payload: dict[str, Any]) -> dict[str, Any]:
    fmt = str(payload.get("format") or "html").strip().lower()
    if fmt not in ("html", "pdf"):
        return {"ok": False, "error": "invalid_format", "detail": "format must be html or pdf"}

    style_json = payload.get("style_json")
    template = payload.get("html_template")
    if not isinstance(template, dict):
        template = get_html_template_from_style(style_json if isinstance(style_json, dict) else None)

    if not isinstance(template, dict):
        segments = payload.get("segments")
        if isinstance(segments, list) and segments:
            template = build_html_template_v1(
                segments=segments,
                structure_blueprint=payload.get("structure_blueprint")
                if isinstance(payload.get("structure_blueprint"), dict)
                else None,
                profile_name=str(payload.get("profile_name") or ""),
            )
        else:
            return {
                "ok": False,
                "error": "html_template_missing",
                "detail": "Re-analyze corpus or POST /v1/corpus/template/build with segments",
            }

    parameters = await _resolve_parameters(payload, template)
    html_doc = render_html_document(template, parameters)
    corpus_id = payload.get("corpus_id")

    base: dict[str, Any] = {
        "corpus_id": corpus_id,
        "format": fmt,
        "html": html_doc,
        "html_template": template,
        "parameters": parameters,
    }

    if fmt == "html":
        return {"ok": True, **base}

    pdf_result = render_pdf_from_html(html_doc)
    if not pdf_result.get("ok"):
        return {**pdf_result, **base}

    out: dict[str, Any] = {"ok": True, **base, **pdf_result}
    conversation_id = payload.get("conversation_id")
    if conversation_id and pdf_result.get("pdf_bytes_b64"):
        import base64

        from oaao_orchestrator.material_storage import persist_artifact_dict, save_storage

        try:
            cid = int(conversation_id)
        except (TypeError, ValueError):
            cid = 0
        if cid > 0:
            pdf_bytes = base64.standard_b64decode(str(pdf_result["pdf_bytes_b64"]))
            material_id = str(payload.get("material_id") or f"corpus-pdf-{corpus_id or 'doc'}")
            name = str(payload.get("file_name") or "corpus_document.pdf")
            domain_cfg = payload.get("object_storage") if isinstance(payload.get("object_storage"), dict) else None
            loc = save_storage(
                conversation_id=cid,
                material_id=material_id,
                data=pdf_bytes,
                file_name=name,
                domain_config=domain_cfg,
            )
            artifact = persist_artifact_dict(
                conversation_id=cid,
                artifact={
                    "material_id": material_id,
                    "name": name,
                    "mime": "application/pdf",
                    "storage_locator": loc,
                    "tool_id": "office_generate",
                    "agent_kind": "office_generate",
                    "status": "ready",
                },
                domain_config=domain_cfg,
                prefer_material_id=True,
            )
            out["material"] = artifact
            out["material_id"] = material_id

    return out
