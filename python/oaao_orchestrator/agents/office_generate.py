"""CS-3 — office_generate agent: corpus HTML template → PDF/DOCX artifact."""

from __future__ import annotations

import base64
import logging
from typing import Any

from oaao_orchestrator.corpus.docx_render import markdown_to_docx_bytes
from oaao_orchestrator.corpus.xlsx_render import markdown_to_xlsx_bytes
from oaao_orchestrator.corpus.render_worker import run_corpus_render
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_AGENT
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import emit_agent_end, emit_agent_start, run_agent_task_step
from oaao_orchestrator.tasks.models import (
    AgentResult,
    AgentSpec,
    AgentStatus,
    AgentTaskSpec,
    RunPlan,
    RunTaskSpec,
)

logger = logging.getLogger(__name__)


def _artifact_dict(
    *,
    material_id: str,
    file_name: str,
    mime: str,
    b64: str,
    run_task_id: str,
) -> dict[str, Any]:
    return {
        "id": material_id,
        "material_id": material_id,
        "name": file_name,
        "mime": mime,
        "b64": b64,
        "tool_id": "office_generate",
        "agent_kind": "office_generate",
        "run_task_id": run_task_id,
        "status": "ready",
    }


class OfficeGenerateAgent:
    agent_kind = "office_generate"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        params = run_task.params if isinstance(run_task.params, dict) else {}
        source = str(params.get("source") or "corpus_template").strip().lower()
        fmt = str(params.get("format") or "pdf").strip().lower()
        if fmt not in ("html", "pdf", "docx", "xlsx"):
            fmt = "pdf"

        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = ctx.extra.get("pipeline_snap_base")
        pipeline_snap: dict[str, Any] = (
            dict(pipeline_base) if isinstance(pipeline_base, dict) else {}
        )

        agent = AgentSpec(
            id=f"ag-{run_task.id}",
            run_task_id=run_task.id,
            kind=self.agent_kind,
            status=AgentStatus.RUNNING,
        )
        await emit_agent_start(
            run,
            phase=PHASE_AGENT,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap or None,
        )

        if source not in ("corpus_template", "corpus_brief", "message"):
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=False,
                error=f"unsupported_source:{source}",
            )
            return AgentResult(success=False, error=f"unsupported_source:{source}")

        brief = str(params.get("brief") or "").strip()
        for msg in reversed(list(ctx.messages or [])):
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                brief = brief or content.strip()[:2000]
                break

        material_id = str(params.get("material_id") or f"office-{run_task.id}")
        file_name = str(params.get("file_name") or ("document.pdf" if fmt == "pdf" else "document.docx"))
        if fmt == "docx" and not file_name.lower().endswith(".docx"):
            file_name = file_name.rsplit(".", 1)[0] + ".docx" if "." in file_name else file_name + ".docx"
        if fmt == "xlsx" and not file_name.lower().endswith(".xlsx"):
            file_name = file_name.rsplit(".", 1)[0] + ".xlsx" if "." in file_name else file_name + ".xlsx"

        if fmt == "xlsx":
            title = str(params.get("title") or "Sheet1")
            xlsx_bytes = markdown_to_xlsx_bytes(brief or " ", title=title)
            b64 = base64.b64encode(xlsx_bytes).decode("ascii")
            artifacts = [
                _artifact_dict(
                    material_id=material_id,
                    file_name=file_name,
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    b64=b64,
                    run_task_id=run_task.id,
                )
            ]
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=True,
                artifacts=artifacts,
            )
            return AgentResult(success=True, artifacts=artifacts, data={"format": "xlsx"})

        if fmt == "docx":
            title = str(params.get("title") or "Document")
            docx_bytes = markdown_to_docx_bytes(brief or " ", title=title)
            b64 = base64.b64encode(docx_bytes).decode("ascii")
            artifacts = [
                _artifact_dict(
                    material_id=material_id,
                    file_name=file_name,
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    b64=b64,
                    run_task_id=run_task.id,
                )
            ]
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=True,
                artifacts=artifacts,
            )
            return AgentResult(success=True, artifacts=artifacts, data={"format": "docx"})

        if source == "message":
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=False,
                error="message_source_requires_docx_or_xlsx_format",
            )
            return AgentResult(success=False, error="message_source_requires_docx_or_xlsx_format")

        corpus_style = ctx.extra.get("corpus_style")
        if not isinstance(corpus_style, dict):
            req = ctx.extra.get("chat_request")
            corpus_style = getattr(req, "corpus_style", None) if req is not None else None

        style_json = None
        if isinstance(corpus_style, dict):
            style_json = corpus_style.get("style_json")
        if not isinstance(style_json, dict):
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=False,
                error="corpus_style_missing",
            )
            return AgentResult(success=False, error="corpus_style_missing")

        agent_task = AgentTaskSpec(
            id=f"at-{run_task.id}-render",
            title="Render document",
            agent_id=agent.id,
            run_task_id=run_task.id,
            index=1,
            total=1,
        )

        async def _render_step() -> None:
            return None

        await run_agent_task_step(
            run,
            phase=PHASE_AGENT,
            plan=plan,
            run_task=run_task,
            agent=agent,
            agent_task=agent_task,
            pipeline_snap=pipeline_snap,
            runner=_render_step,
        )

        payload: dict[str, Any] = {
            "format": fmt,
            "style_json": style_json,
            "profile_name": str(corpus_style.get("name") or ""),
            "corpus_id": corpus_style.get("corpus_id"),
            "brief": brief,
            "parameters": params.get("parameters") if isinstance(params.get("parameters"), dict) else {},
            "background": False,
            "conversation_id": ctx.conversation_id,
            "material_id": material_id,
            "file_name": file_name,
        }
        llm_raw = ctx.extra.get("llm_cfg") or params.get("llm_cfg")
        if isinstance(llm_raw, dict):
            payload["llm_cfg"] = llm_raw

        obj = ctx.extra.get("object_storage")
        if isinstance(obj, dict):
            payload["object_storage"] = obj

        result = await run_corpus_render(payload)
        artifacts: list[dict[str, Any]] = []
        mid = str(payload["material_id"])
        fname = str(payload["file_name"])
        if isinstance(result.get("material"), dict):
            mat = dict(result["material"])
            if "id" not in mat and mat.get("material_id"):
                mat["id"] = mat["material_id"]
            artifacts.append(mat)
        elif result.get("pdf_bytes_b64"):
            artifacts.append(
                _artifact_dict(
                    material_id=mid,
                    file_name=fname,
                    mime="application/pdf",
                    b64=str(result["pdf_bytes_b64"]),
                    run_task_id=run_task.id,
                )
            )

        ok = bool(result.get("ok"))
        err = str(result.get("error") or "") if not ok else None

        await emit_agent_end(
            run,
            phase=PHASE_AGENT,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap,
            success=ok,
            error=err,
            artifacts=artifacts if ok else [],
        )
        if not ok:
            return AgentResult(success=False, error=err or "render_failed", artifacts=artifacts)
        return AgentResult(success=True, artifacts=artifacts, data=result)
