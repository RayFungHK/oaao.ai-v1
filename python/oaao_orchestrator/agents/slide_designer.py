"""
Slide designer agent (SD-2–SD-4) — project files, LLM outline/markdown, HTML sandbox, fan-out pages.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.agents.slide_pipeline_blocks import build_slide_preview_strip_block
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.slide_project.fanout import format_slide_page_title
from oaao_orchestrator.slide_project.store import SlideBuildSession, SlideProjectStore
from oaao_orchestrator.streaming.events import PHASE_AGENT, PHASE_SANDBOX
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import (
    _upsert_agent_task_row,
    emit_agent_end,
    emit_agent_start,
    emit_agent_task_progress,
    emit_slide_worker_progress,
    run_agent_task_step,
)
from oaao_orchestrator.tasks.models import (
    AgentResult,
    AgentSpec,
    AgentStatus,
    AgentTaskSpec,
    AgentTaskStatus,
    RunPlan,
    RunTaskSpec,
)

logger = logging.getLogger(__name__)

_FULL_STEPS: tuple[tuple[str, str, str], ...] = (
    ("project", "Create or load slide project", PHASE_AGENT),
    ("outline", "Outline deck markdown", PHASE_AGENT),
    ("style", "Define deck visual style", PHASE_AGENT),
    ("slides", "Write per-slide markdown", PHASE_AGENT),
    ("html", "Build slide HTML (sandbox)", PHASE_SANDBOX),
    ("export", "Export deck artifact", PHASE_AGENT),
)

_OUTLINE_STEPS: tuple[tuple[str, str, str], ...] = (
    ("project", "Create or load slide project", PHASE_AGENT),
    ("outline", "Outline deck markdown", PHASE_AGENT),
    ("style", "Define deck visual style", PHASE_AGENT),
)

_PAGE_STEPS: tuple[tuple[str, str, str], ...] = (
    ("page", "Build slide page (markdown + HTML)", PHASE_SANDBOX),
)

_EXPORT_STEPS: tuple[tuple[str, str, str], ...] = (
    ("export", "Export deck artifact", PHASE_AGENT),
)

_CONTINUE_STEPS: tuple[tuple[str, str, str], ...] = (
    ("project", "Load slide project", PHASE_AGENT),
    ("continue", "Fill missing slides", PHASE_SANDBOX),
    ("export", "Export slide deck", PHASE_AGENT),
)


def _artifacts_from_manifest(manifest: dict[str, Any], run_task_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in manifest.get("files") or []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "id": str(f.get("id") or f"mat-{run_task_id}-{name}"),
                "name": name,
                "mime": f.get("mime"),
                "size_bytes": f.get("size_bytes"),
                "uri": f.get("uri"),
                "tool_id": "slides_export" if name.endswith(".pptx") else "slide_project",
                "agent_kind": "slide_designer" if not name.endswith(".log") else "sandbox_code",
                "run_task_id": run_task_id,
                "status": "ready",
                "category": f.get("category"),
                "project_id": manifest.get("project_id"),
            }
        )
    return out


def _vault_grounding_from_ctx(ctx: RunContext) -> str:
    raw = ctx.extra.get("vault_grounding_for_slides")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    from oaao_orchestrator.slide_project.rag_context import (  # noqa: PLC0415
        vault_grounding_from_messages,
    )

    return vault_grounding_from_messages(list(ctx.messages))


def _llm_from_ctx(ctx: RunContext) -> tuple[str | None, str | None, str | None]:
    url = ctx.extra.get("llm_url")
    key = ctx.extra.get("llm_api_key")
    model = ctx.model or ctx.extra.get("llm_model")
    if isinstance(url, str) and url.strip():
        return url.strip(), key if isinstance(key, str) else None, str(model) if model else None
    return None, None, str(model) if model else None


def _slide_phase(run_task: RunTaskSpec) -> str:
    raw = (run_task.params or {}).get("slide_phase")
    return str(raw).strip().lower() if raw is not None else "full"


def _template_id_from_slide_designer_cfg(sd_cfg: object) -> str | None:
    if not isinstance(sd_cfg, dict):
        return None
    tid = sd_cfg.get("template_id")
    if isinstance(tid, str) and tid.strip():
        return tid.strip()
    return None


def _slide_designer_cfg(ctx: RunContext) -> dict[str, Any]:
    sd = ctx.extra.get("slide_designer")
    return sd if isinstance(sd, dict) else {}


def _start_new_deck_from_template(sd_cfg: dict[str, Any]) -> bool:
    return sd_cfg.get("start_new_deck") is True and bool(str(sd_cfg.get("template_id") or "").strip())


def _regenerate_deck(sd_cfg: dict[str, Any]) -> bool:
    return bool(sd_cfg.get("regenerate_deck"))


def _project_id_from(ctx: RunContext, run_task: RunTaskSpec) -> str | None:
    params = run_task.params if isinstance(run_task.params, dict) else {}
    pid = params.get("project_id") or params.get("resume_project_id")
    if isinstance(pid, str) and pid.strip():
        return pid.strip()
    shared = ctx.extra.get("slide_project_id")
    if isinstance(shared, str) and shared.strip():
        return shared.strip()
    sd = _slide_designer_cfg(ctx)
    if _start_new_deck_from_template(sd) or _regenerate_deck(sd):
        return None
    rid = sd.get("resume_project_id")
    if isinstance(rid, str) and rid.strip():
        return rid.strip()
    return None


def _resume_project_for_session(ctx: RunContext, run_task: RunTaskSpec) -> str | None:
    """Honor in-run ``slide_project_id``; block stale PHP auto-resume when ``start_new_deck``."""
    return _project_id_from(ctx, run_task)


class SlideDesignerAgent:
    agent_kind = "slide_designer"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        phase = _slide_phase(run_task)
        if phase == "outline":
            return await self._run_phased(run=run, run_task=run_task, ctx=ctx, steps=_OUTLINE_STEPS, mode="outline")
        if phase == "page":
            return await self._run_page_worker(run=run, run_task=run_task, ctx=ctx)
        if phase == "export":
            return await self._run_phased(run=run, run_task=run_task, ctx=ctx, steps=_EXPORT_STEPS, mode="export")
        if phase == "continue":
            return await self._run_phased(
                run=run, run_task=run_task, ctx=ctx, steps=_CONTINUE_STEPS, mode="continue"
            )
        return await self._run_phased(run=run, run_task=run_task, ctx=ctx, steps=_FULL_STEPS, mode="full")

    def _preview_from_progress(self, data: dict[str, Any]) -> dict[str, Any]:
        phase = str(data.get("phase") or "").strip().lower()
        out: dict[str, Any] = {
            "kind": "slide_page",
            "phase": phase,
            "slide_index": data.get("slide_index"),
            "building": bool(data.get("building")),
        }
        if data.get("title"):
            out["title"] = data["title"]
        if isinstance(data.get("snippet"), str):
            out["snippet"] = data["snippet"]
        if isinstance(data.get("preview_url"), str):
            out["preview_url"] = data["preview_url"]
        return out

    async def _run_page_worker(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        """SD-4 parallel page — stream markdown/HTML preview into workers parent row."""
        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = ctx.extra.get("pipeline_snap_base")
        pipeline_snap: dict[str, Any] = dict(pipeline_base) if isinstance(pipeline_base, dict) else {}
        allowed = ctx.extra.get("allowed_agents")
        allowed_agents = list(allowed) if isinstance(allowed, list) else []

        agent = AgentSpec(
            id=f"ag-{run_task.id}",
            run_task_id=run_task.id,
            kind=self.agent_kind,
            status=AgentStatus.RUNNING,
        )
        await emit_agent_start(
            run,
            phase=PHASE_SANDBOX,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap or None,
        )

        sd_cfg = ctx.extra.get("slide_designer")
        root = None
        if isinstance(sd_cfg, dict) and isinstance(sd_cfg.get("storage_root"), str):
            root = Path(sd_cfg["storage_root"].strip())

        store = SlideProjectStore(root=root)
        llm_url, llm_api_key, llm_model = _llm_from_ctx(ctx)
        vault_grounding = _vault_grounding_from_ctx(ctx)
        slide_index = int((run_task.params or {}).get("slide_index") or 0)
        session: SlideBuildSession | None = None

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")

            resume = _resume_project_for_session(ctx, run_task)
            template_id = _template_id_from_slide_designer_cfg(sd_cfg)
            session = await store.open_build_session(
                conversation_id=ctx.conversation_id,
                assistant_message_id=str(ctx.extra.get("assistant_message_id") or "")
                if ctx.extra.get("assistant_message_id") is not None
                else None,
                user_id=ctx.user_id,
                workspace_id=int(ws)
                if (ws := ctx.extra.get("workspace_id")) is not None
                and str(ws).strip().isdigit()
                else None,
                run_task_id=run_task.id,
                resume_project_id=resume,
                title=str(run_task.title) if run_task.title else None,
                template_id=None if resume else template_id,
            )
            if session.manifest.get("project_id"):
                ctx.extra["slide_project_id"] = str(session.manifest["project_id"])

            slide_count = int((run_task.params or {}).get("slide_count") or 0)
            idx = slide_index if slide_index > 0 else 1

            async def _on_progress(data: dict[str, Any]) -> None:
                if slide_count > 0 and "slide_count" not in data:
                    data = {**data, "slide_count": slide_count}
                preview = self._preview_from_progress(data)
                idx_prog = int(data.get("slide_index") or idx)
                total_prog = int(data.get("slide_count") or slide_count or idx_prog)
                slide_title = str(data.get("title") or "").strip()
                label = format_slide_page_title(idx_prog, total_prog, slide_title or None)
                run_task.title = label
                await emit_slide_worker_progress(
                    run,
                    phase=PHASE_SANDBOX,
                    plan=plan,
                    run_task=run_task,
                    agent=agent,
                    allowed_agents=allowed_agents,
                    pipeline_snap=pipeline_snap or None,
                    status="running",
                    preview=preview,
                    title=label,
                )

            page_entry = await session.phase_single_page(
                idx,
                messages=list(ctx.messages),
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
                on_progress=_on_progress,
                vault_grounding=vault_grounding,
            )

            params0 = run_task.params if isinstance(run_task.params, dict) else {}
            slide_title = str(params0.get("slide_title") or params0.get("title") or "").strip()
            if not slide_title and isinstance(page_entry, dict):
                slide_title = str(page_entry.get("title") or "").strip()
            total = slide_count or int((run_task.params or {}).get("slide_count") or 0) or idx
            label = format_slide_page_title(idx, total, slide_title or None)
            run_task.title = label
            done_preview: dict[str, Any] = {
                "phase": "ready",
                "slide_index": idx,
                "slide_count": total,
                "building": False,
            }
            if slide_title:
                done_preview["title"] = slide_title
            if isinstance(page_entry, dict) and page_entry.get("preview_url"):
                done_preview["preview_url"] = page_entry["preview_url"]
            preview_done = self._preview_from_progress(done_preview)
            params = dict(run_task.params or {})
            params["slide_title"] = slide_title
            params["preview"] = preview_done
            if isinstance(page_entry, dict) and page_entry.get("preview_url"):
                params["preview_url"] = page_entry["preview_url"]
            run_task.params = params
            await emit_slide_worker_progress(
                run,
                phase=PHASE_SANDBOX,
                plan=plan,
                run_task=run_task,
                agent=agent,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap or None,
                status="done",
                preview=preview_done,
                title=label,
            )

            manifest = session.manifest if session else None
            if not isinstance(manifest, dict) or not manifest.get("project_id"):
                return AgentResult(success=False, error="slide page build produced no manifest")

            await emit_agent_end(
                run,
                phase=PHASE_SANDBOX,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
            )
            return AgentResult(
                success=True,
                extra={"slide_project": manifest, "agent_kind": self.agent_kind},
            )
        except Exception as exc:
            logger.exception("slide_page_worker_failed run_task=%s", run_task.id)
            await emit_slide_worker_progress(
                run,
                phase=PHASE_SANDBOX,
                plan=plan,
                run_task=run_task,
                agent=agent,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap or None,
                status="failed",
            )
            await emit_agent_end(
                run,
                phase=PHASE_SANDBOX,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
            )
            return AgentResult(success=False, error=str(exc)[:400])

    async def _run_phased(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
        steps: tuple[tuple[str, str, str], ...],
        mode: str,
    ) -> AgentResult:
        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = ctx.extra.get("pipeline_snap_base")
        pipeline_snap: dict[str, Any] = dict(pipeline_base) if isinstance(pipeline_base, dict) else {}

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

        sd_cfg = ctx.extra.get("slide_designer")
        root = None
        if isinstance(sd_cfg, dict) and isinstance(sd_cfg.get("storage_root"), str):
            root = Path(sd_cfg["storage_root"].strip())

        store = SlideProjectStore(root=root)
        llm_url, llm_api_key, llm_model = _llm_from_ctx(ctx)
        vault_grounding = _vault_grounding_from_ctx(ctx)
        session: SlideBuildSession | None = None
        msgs = list(ctx.messages)
        slide_index = int((run_task.params or {}).get("slide_index") or 0)

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")

            async def _open_session() -> SlideBuildSession:
                nonlocal session
                resume = _resume_project_for_session(ctx, run_task)
                sd_cfg = _slide_designer_cfg(ctx)
                template_id = _template_id_from_slide_designer_cfg(sd_cfg)
                session = await store.open_build_session(
                    conversation_id=ctx.conversation_id,
                    assistant_message_id=str(ctx.extra.get("assistant_message_id") or "")
                    if ctx.extra.get("assistant_message_id") is not None
                    else None,
                    user_id=ctx.user_id,
                    workspace_id=int(ws)
                    if (ws := ctx.extra.get("workspace_id")) is not None
                    and str(ws).strip().isdigit()
                    else None,
                    run_task_id=run_task.id,
                    resume_project_id=resume,
                    title=str(run_task.title) if run_task.title else None,
                    template_id=None if resume else template_id,
                )
                if session.manifest.get("project_id"):
                    ctx.extra["slide_project_id"] = str(session.manifest["project_id"])
                return session

            async def _outline_only() -> None:
                assert session is not None
                await session.phase_outline(
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )
                ctx.extra["slide_project_id"] = session.project_id

            async def _page_only() -> None:
                nonlocal session
                if session is None:
                    await _open_session()
                assert session is not None
                idx = slide_index if slide_index > 0 else 1
                await session.phase_single_page(
                    idx,
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )

            async def _export_only() -> None:
                nonlocal session
                if session is None:
                    await _open_session()
                assert session is not None
                await session.phase_export_from_disk()

            async def _continue_deck() -> None:
                nonlocal session
                if session is None:
                    await _open_session()
                assert session is not None
                await session.phase_continue(
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )

            async def _full_outline() -> None:
                assert session is not None
                await session.phase_outline(
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )

            async def _full_markdown() -> None:
                assert session is not None
                await session.phase_markdown(
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )

            async def _full_html() -> None:
                assert session is not None
                await session.phase_html(
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                )

            async def _deck_style() -> None:
                assert session is not None
                await session.phase_deck_style(
                    messages=msgs,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                )

            step_work: dict[str, Any] = {
                "project": _open_session,
                "outline": _outline_only if mode == "outline" else _full_outline,
                "style": _deck_style,
                "slides": _full_markdown,
                "html": _full_html if mode == "full" else _page_only,
                "page": _page_only,
                "continue": _continue_deck,
                "export": _export_only,
            }

            agent_tasks_accum: list[dict[str, Any]] = []
            total = len(steps)
            for idx, (suffix, title, phase_id) in enumerate(steps, start=1):
                if run.cancelled:
                    return AgentResult(success=False, error="cancelled")
                agent_task = AgentTaskSpec(
                    id=f"at-{run_task.id}-{suffix}",
                    title=title,
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=idx,
                    total=total,
                )
                work = step_work.get(suffix)
                if work is None:

                    async def _noop() -> None:
                        return None

                    work = _noop

                if suffix == "outline":

                    async def _outline_with_stream() -> None:
                        assert session is not None

                        async def on_outline(md: str) -> None:
                            agent_task.params = {
                                **(agent_task.params or {}),
                                "preview": {
                                    "outline_md": md,
                                    "phase": "outline",
                                    "building": True,
                                },
                            }
                            agent_task.status = AgentTaskStatus.RUNNING
                            _upsert_agent_task_row(agent_tasks_accum, agent_task)
                            await emit_agent_task_progress(
                                run,
                                phase=phase_id,
                                plan=plan,
                                run_task=run_task,
                                agent=agent,
                                agent_task=agent_task,
                                pipeline_snap=pipeline_snap or None,
                                agent_tasks_accum=agent_tasks_accum,
                            )

                        await session.phase_outline(
                            messages=msgs,
                            llm_url=llm_url,
                            llm_api_key=llm_api_key,
                            llm_model=llm_model,
                            vault_grounding=vault_grounding,
                            on_outline_progress=on_outline,
                        )
                        ctx.extra["slide_project_id"] = session.project_id
                        agent_task.params = {
                            **(agent_task.params or {}),
                            "preview": {
                                "outline_md": session.outline_body,
                                "phase": "outline",
                                "building": False,
                                "project_id": session.project_id,
                            },
                        }

                    work = _outline_with_stream

                await run_agent_task_step(
                    run,
                    phase=phase_id,
                    plan=plan,
                    run_task=run_task,
                    agent=agent,
                    agent_task=agent_task,
                    pipeline_snap=pipeline_snap or None,
                    work=work,
                    agent_tasks_accum=agent_tasks_accum,
                )

            manifest = session.manifest if session else None
            if mode == "export" and session is not None:
                manifest = session.manifest
            if not isinstance(manifest, dict) or not manifest.get("project_id"):
                return AgentResult(success=False, error="slide project build produced no manifest")

            artifacts: list[dict[str, Any]] = []
            extra: dict[str, Any] = {"slide_project": manifest, "agent_kind": self.agent_kind}
            if mode in ("export", "full", "continue"):
                artifacts = _artifacts_from_manifest(manifest, run_task.id)
                blocks = [b for b in (pipeline_snap.get("blocks") or []) if isinstance(b, dict)]
                blocks.append(
                    build_slide_preview_strip_block(run_task_id=run_task.id, manifest=manifest)
                )
                extra["pipeline_blocks"] = blocks

            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                agent_tasks=agent_tasks_accum if agent_tasks_accum else None,
            )
            return AgentResult(success=True, artifacts=artifacts, extra=extra)
        except Exception as exc:
            logger.exception("slide_designer_failed run_task=%s mode=%s", run_task.id, mode)
            await emit_agent_end(
                run,
                phase=PHASE_AGENT,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
                agent_tasks=agent_tasks_accum if agent_tasks_accum else None,
            )
            return AgentResult(success=False, error=str(exc)[:400])
