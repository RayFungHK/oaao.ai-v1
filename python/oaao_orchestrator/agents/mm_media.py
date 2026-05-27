"""
Multimodal media agents — mm_understand / mm_generate / mm_edit (MM-EPIC).

Planner registers these kinds; this module executes them via MediaCapabilityClient.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.media.capability_client import MediaCapabilityClient
from oaao_orchestrator.media.mm_tasks import (
    resolve_mm_edit_task,
    resolve_mm_generate_task,
    resolve_mm_understand_task,
)
from oaao_orchestrator.media.openai_vision import text_from_openai_payload
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.planner_llm import _last_user_message
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

MM_AGENT_KINDS = frozenset({"mm_understand", "mm_generate", "mm_edit"})

_AXIS_BY_KIND: dict[str, str] = {
    "mm_understand": "understand",
    "mm_generate": "generate",
    "mm_edit": "edit",
}

_BINDING_KEY: dict[str, str] = {
    "understand": "mm_understand",
    "generate": "mm_generate",
    "edit": "mm_edit",
}

_DEFAULT_TASK: dict[str, str] = {
    "understand": "x2t_image",
    "generate": "t2i",
    "edit": "image_edit",
}


def _image_data_url(path: str, mime: str) -> str | None:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        raw = p.read_bytes()
        if len(raw) > 12_000_000:
            return None
        mt = mime if mime.startswith("image/") else (mimetypes.guess_type(path)[0] or "image/png")
        b64 = base64.standard_b64encode(raw).decode("ascii")
        return f"data:{mt};base64,{b64}"
    except OSError:
        return None


def _attachment_rows(ctx: RunContext, run_task: RunTaskSpec) -> list[dict[str, Any]]:
    snap = ctx.extra.get("chat_attachment_snapshot")
    rows: list[dict[str, Any]] = []
    if isinstance(snap, list):
        rows.extend(a for a in snap if isinstance(a, dict))
    if rows:
        return rows
    raw = ctx.extra.get("chat_attachments")
    if isinstance(raw, list):
        return [a for a in raw if isinstance(a, dict)]
    params = run_task.params if isinstance(run_task.params, dict) else {}
    ids_raw = params.get("attachment_ids")
    if not isinstance(ids_raw, list) or not ids_raw:
        return rows
    want = {int(x) for x in ids_raw if str(x).isdigit()}
    if not want:
        return rows
    return [a for a in rows if int(a.get("id") or 0) in want]


def _understand_attachments(ctx: RunContext, run_task: RunTaskSpec) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for att in _attachment_rows(ctx, run_task):
        mime = str(att.get("mime_type") or att.get("mime") or "").strip().lower()
        path = str(att.get("absolute_path") or att.get("path") or "").strip()
        if path and (mime.startswith("image/") or mime.startswith("video/")):
            out.append(att)
    return out


def _edit_attachments(ctx: RunContext, run_task: RunTaskSpec) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for att in _attachment_rows(ctx, run_task):
        mime = str(att.get("mime_type") or att.get("mime") or "").strip().lower()
        path = str(att.get("absolute_path") or att.get("path") or "").strip()
        if path and (mime.startswith("image/") or mime.startswith("video/")):
            out.append(att)
    return out


def _prompt_from_task(ctx: RunContext, run_task: RunTaskSpec) -> str:
    params = run_task.params if isinstance(run_task.params, dict) else {}
    for key in ("prompt", "user_prompt", "instruction"):
        raw = params.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return _last_user_message(list(ctx.messages))


def _append_system_note(ctx: RunContext, note: str) -> None:
    if not note.strip():
        return
    messages = list(ctx.messages)
    block = f"[{note.strip()}]"
    if messages and str(messages[0].get("role") or "").lower() == "system":
        prev = messages[0].get("content")
        messages[0]["content"] = (
            f"{block}\n\n{prev}" if isinstance(prev, str) and prev.strip() else block
        )
    else:
        messages.insert(0, {"role": "system", "content": block})
    ctx.messages = messages


def _artifact_from_result(
    result: dict[str, Any],
    *,
    run_task_id: str,
    agent_kind: str,
    default_name: str,
) -> dict[str, Any] | None:
    if not result.get("ok"):
        return None
    url = str(result.get("image_url") or result.get("url") or "").strip()
    path = str(result.get("path") or result.get("output_path") or "").strip()
    b64 = str(result.get("image_base64") or result.get("b64") or "").strip()
    name = str(result.get("file_name") or result.get("name") or default_name).strip() or default_name
    mime = str(result.get("mime") or result.get("mime_type") or "image/png").strip()
    art: dict[str, Any] = {
        "id": f"mm-{run_task_id}",
        "name": name,
        "mime": mime,
        "tool_id": agent_kind,
        "agent_kind": agent_kind,
        "run_task_id": run_task_id,
        "status": "ready" if url or path or b64 else "deferred",
    }
    if url:
        art["url"] = url
    if path:
        art["path"] = path
    if b64:
        art["image_base64"] = b64
    if art["status"] == "deferred" and result.get("deferred"):
        art["status"] = "queued"
        art["queue_hint"] = result.get("queue_hint") or "heavy_gpu"
    if url or path or b64 or result.get("deferred"):
        return art
    text = text_from_openai_payload(result)
    if text:
        art["caption"] = text[:8000]
        art["status"] = "caption_only"
        return art
    return None


def _image_preview_block(result: dict[str, Any], *, agent_kind: str) -> dict[str, Any] | None:
    url = str(result.get("image_url") or result.get("url") or "").strip()
    caption = text_from_openai_payload(result)
    if not url and not caption:
        return None
    props: dict[str, Any] = {"agent_kind": agent_kind, "inline": True}
    if url:
        props["image_url"] = url
    if caption:
        props["caption"] = caption[:4000]
    return {"type": "mm_image_result", "zone": "inline", "props": props}


class MmMediaAgent:
    """Single runner class — ``agent_kind`` set per factory instance."""

    def __init__(self, agent_kind: str) -> None:
        kind = agent_kind.strip()
        if kind not in MM_AGENT_KINDS:
            raise ValueError(f"unsupported mm agent_kind={kind!r}")
        self.agent_kind = kind
        self._axis = _AXIS_BY_KIND[kind]

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
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

        binding_key = _BINDING_KEY[self._axis]
        binding = ctx.extra.get(binding_key)
        if not isinstance(binding, dict) or not binding.get("purpose_key"):
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
            )
            return AgentResult(
                success=False,
                error=f"mm_binding_missing:{binding_key}",
            )

        task = str(binding.get("default_task") or _DEFAULT_TASK[self._axis]).strip()
        prompt = _prompt_from_task(ctx, run_task)
        understand_media = _understand_attachments(ctx, run_task)
        edit_media = _edit_attachments(ctx, run_task)

        agent_task = AgentTaskSpec(
            id=f"at-{run_task.id}-mm",
            title={
                "understand": "Understand attachments",
                "generate": "Generate image",
                "edit": "Edit image",
            }[self._axis],
            agent_id=agent.id,
            run_task_id=run_task.id,
            index=1,
            total=1,
        )

        mc = MediaCapabilityClient()
        artifacts: list[dict[str, Any]] = []
        pipeline_blocks: list[dict[str, Any]] = []
        notes: list[str] = []

        async def _work() -> None:
            nonlocal artifacts, pipeline_blocks, notes
            if self._axis == "understand":
                if not understand_media:
                    notes.append(
                        "mm_understand: no image/video attachments — describe media in your reply "
                        "from prior attachment excerpts if present."
                    )
                    return
                captions: list[str] = []
                async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as http:
                    for att in understand_media[:4]:
                        path = str(att.get("absolute_path") or att.get("path") or "")
                        mime = str(att.get("mime_type") or att.get("mime") or "image/png")
                        fname = str(att.get("file_name") or att.get("name") or Path(path).name)
                        att_task = resolve_mm_understand_task(mime, fallback=task)
                        url = _image_data_url(path, mime)
                        result = await mc.run(
                            binding,
                            task=att_task,
                            inputs={
                                "image_url": url or "",
                                "path": path,
                                "mime_type": mime,
                                "prompt": prompt,
                                "http_client": http,
                            },
                        )
                        text = text_from_openai_payload(result)
                        if text:
                            captions.append(f"{fname}:\n{text[:8000]}")
                        elif result.get("deferred"):
                            captions.append(
                                f"{fname}: [mm.understand queued — configure Lance or vision endpoint]"
                            )
                if captions:
                    notes.append(
                        "Multimodal understand (agent):\n\n" + "\n\n---\n\n".join(captions)
                    )
                return

            if self._axis == "generate":
                if not prompt:
                    notes.append("mm_generate: missing prompt.")
                    return
                gen_task = resolve_mm_generate_task(prompt, fallback=task)
                result = await mc.run(
                    binding,
                    task=gen_task,
                    inputs={"prompt": prompt, "text": prompt},
                )
                art = _artifact_from_result(
                    result,
                    run_task_id=run_task.id,
                    agent_kind=self.agent_kind,
                    default_name="generated.png",
                )
                if art:
                    artifacts.append(art)
                block = _image_preview_block(result, agent_kind=self.agent_kind)
                if block:
                    pipeline_blocks.append(block)
                text = text_from_openai_payload(result)
                if text:
                    notes.append(f"Generated image note:\n{text[:4000]}")
                elif result.get("deferred"):
                    notes.append(
                        "Image generation queued on heavy GPU worker — configure OAAO_LANCE_BASE_URL."
                    )
                return

            if self._axis == "edit":
                if not edit_media:
                    notes.append("mm_edit: attach a source image or video to edit.")
                    return
                att = edit_media[0]
                path = str(att.get("absolute_path") or att.get("path") or "")
                mime = str(att.get("mime_type") or att.get("mime") or "image/png")
                edit_task = resolve_mm_edit_task(mime, fallback=task)
                url = _image_data_url(path, mime)
                result = await mc.run(
                    binding,
                    task=edit_task,
                    inputs={
                        "image_url": url or "",
                        "path": path,
                        "mime_type": mime,
                        "prompt": prompt,
                        "instruction": prompt,
                    },
                )
                art = _artifact_from_result(
                    result,
                    run_task_id=run_task.id,
                    agent_kind=self.agent_kind,
                    default_name="edited.png",
                )
                if art:
                    artifacts.append(art)
                block = _image_preview_block(result, agent_kind=self.agent_kind)
                if block:
                    pipeline_blocks.append(block)
                text = text_from_openai_payload(result)
                if text:
                    notes.append(f"Edited image note:\n{text[:4000]}")
                elif result.get("deferred"):
                    notes.append(
                        "Image edit queued on heavy GPU worker — configure OAAO_LANCE_BASE_URL."
                    )

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")
            await run_agent_task_step(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=agent_task,
                pipeline_snap=pipeline_snap or None,
                work=_work,
            )
            for note in notes:
                _append_system_note(ctx, note)

            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
            )
            extra: dict[str, Any] = {"agent_kind": self.agent_kind, "mm_axis": self._axis}
            if pipeline_blocks:
                extra["pipeline_blocks"] = pipeline_blocks
            return AgentResult(success=True, artifacts=artifacts, extra=extra)
        except Exception as exc:
            logger.exception("mm_media_agent_failed kind=%s task=%s", self.agent_kind, run_task.id)
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
            )
            return AgentResult(success=False, error=str(exc)[:400])


def mm_media_agent_factory(agent_kind: str):
    def _factory() -> MmMediaAgent:
        return MmMediaAgent(agent_kind)

    return _factory
