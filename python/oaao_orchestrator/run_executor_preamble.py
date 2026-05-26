"""Top-20 #6 phase 10 — execute_chat_run pre-loop preamble extracted.

Bundles the IQS scoring, plan build (including the optional inline clarify
short-circuit), crystallized-skill recall, planner-mode refinement, task
queue + run-context construction. The caller (`execute_chat_run`) wraps the
returned :class:`RunPreamble` straight into its dispatch loop. On the clarify
short-circuit path :attr:`RunPreamble.short_circuit` is ``True`` and the
caller must ``return`` so the finally block can emit the run-end envelope.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.pipeline_ui import (
    build_minimal_pipeline_snapshot,
    merge_vault_chat_sources_into_snapshot,
)
from oaao_orchestrator.planner import build_run_plan
from oaao_orchestrator.planner_llm import planner_enabled
from oaao_orchestrator.run_executor_plan import plan_pipeline_source as _plan_pipeline_source
from oaao_orchestrator.run_executor_timing import (
    elapsed_ms_since as _elapsed_ms_since,
)
from oaao_orchestrator.run_executor_timing import (
    record_pipeline_phase as _record_pipeline_phase,
)
from oaao_orchestrator.run_executor_vault_rag import vault_rag_ctx_extra as _vault_rag_ctx_extra
from oaao_orchestrator.streaming.events import (
    KIND_STATUS,
    PHASE_LLM,
    PHASE_SYSTEM,
    StreamEnvelope,
)
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec
from oaao_orchestrator.tasks.stream_emit import emit_task_list_status

logger = logging.getLogger(__name__)


@dataclass
class RunPreamble:
    """Result of :func:`prepare_run_preamble`.

    When ``short_circuit`` is True the caller has nothing left to do besides
    ``return`` — the helper has already appended the clarify text to
    ``streamed_parts`` and emitted the corresponding envelopes. Otherwise all
    fields are populated and the caller proceeds into the dispatch loop.
    """

    short_circuit: bool = False
    out_chars_delta: int = 0
    run_principal: Any = None
    coach_endpoint: dict[str, Any] | None = None
    iqs_snap: dict[str, Any] | None = None
    pipeline_snap: dict[str, Any] | None = None
    plan: RunPlan | None = None
    run_ctx: RunContext | None = None
    task_queue: list[RunTaskSpec] = field(default_factory=list)
    report_after_ids: set[int] = field(default_factory=set)
    scope_docs: dict[int, list[int]] = field(default_factory=dict)


async def prepare_run_preamble(
    *,
    run: Any,
    req: Any,
    t_start: float,
    messages_for_llm: list[Any],
    pipeline_timing: dict[str, Any],
    streamed_parts: list[str],
    planner_url: str,
    planner_api_key: str | None,
    planner_model: str | None,
    api_key: str | None,
    allowed_agents: Any,
) -> RunPreamble:
    from oaao_orchestrator.chat_helpers import _hook_before_llm
    from oaao_orchestrator.evaluation.coach_client import inline_iqs_clarify_enabled
    from oaao_orchestrator.evaluation.iqs import score_iqs, should_bypass_iqs_clarify
    from oaao_orchestrator.planner_llm import _last_user_message
    from oaao_orchestrator.run_principal import require_for_request

    out_chars_delta = 0

    _hook_before_llm(req)

    run_principal = require_for_request(req)

    user_msg_for_iqs = _last_user_message(messages_for_llm)
    coach_endpoint = req.uiqe if isinstance(req.uiqe, dict) else None
    clarify_gate = inline_iqs_clarify_enabled()

    iqs_snap: dict[str, Any] | None = None
    plan: RunPlan | None = None

    async def _timed_iqs():
        t0 = time.perf_counter()
        res = await score_iqs(
            user_message=user_msg_for_iqs,
            conversation_history=messages_for_llm,
            coach_endpoint=coach_endpoint,
            inline=True,
        )
        return res, _elapsed_ms_since(t0)

    async def _timed_plan() -> tuple[RunPlan, int]:
        t0 = time.perf_counter()
        built = await build_run_plan(
            req,
            chat_completions_url=planner_url,
            api_key=planner_api_key,
            model=planner_model,
        )
        return built, _elapsed_ms_since(t0)

    def _record_plan_phase(duration_ms: int, *, source: str | None = None) -> None:
        _record_pipeline_phase(
            pipeline_timing,
            "plan",
            duration_ms,
            model=planner_model if planner_enabled(req) else None,
            source=source or _plan_pipeline_source(req),
        )

    async def _maybe_recall_crystallized_plan(iqs_result: object, current: RunPlan) -> RunPlan:
        from oaao_orchestrator.crystallization.plan import build_plan_from_tool_chain
        from oaao_orchestrator.crystallization.recall import recall_skill

        if str(getattr(iqs_result, "action", "") or "") not in ("pass", "assume_defaults"):
            return current
        t_recall = time.perf_counter()
        skill_hit = await recall_skill(
            user_msg_for_iqs,
            embedding_cfg=req.embedding if isinstance(req.embedding, dict) else None,
        )
        _record_pipeline_phase(pipeline_timing, "skill_recall", _elapsed_ms_since(t_recall))
        if skill_hit is None:
            return current
        iqs_snap["crystallized_skill_recall"] = {
            "skill_id": skill_hit.skill.id,
            "similarity": round(float(skill_hit.similarity), 4),
            "tool_chain": list(skill_hit.skill.tool_chain),
        }
        _record_plan_phase(0, source="crystallized_skill")
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind=KIND_STATUS,
                text="reusing_crystallized_skill",
                payload={
                    "skill_id": skill_hit.skill.id,
                    "trigger_intent": skill_hit.skill.trigger_intent,
                    "similarity": round(float(skill_hit.similarity), 4),
                    "tool_chain": list(skill_hit.skill.tool_chain),
                },
            )
        )
        return build_plan_from_tool_chain(skill_hit.skill.tool_chain)

    if clarify_gate:
        iqs_result, iqs_ms = await _timed_iqs()
        _record_pipeline_phase(pipeline_timing, "iqs", iqs_ms, source=iqs_result.source)
    else:
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind=KIND_STATUS,
                text="plan_build_start",
                payload={},
            )
        )
        (iqs_result, iqs_ms), (plan, plan_ms) = await asyncio.gather(
            _timed_iqs(), _timed_plan()
        )
        _record_pipeline_phase(pipeline_timing, "iqs", iqs_ms, source=iqs_result.source)
        _record_plan_phase(plan_ms)

    iqs_snap = {
        "iqs_score": round(float(iqs_result.score), 4),
        "iqs_action": iqs_result.action,
        "iqs_dimensions": iqs_result.dimensions,
        "iqs_skipped": bool(iqs_result.skipped),
        "iqs_source": iqs_result.source,
    }

    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="llm_request_start",
            payload={
                "purpose_id": req.purpose_id,
                "chat_profile_id": req.chat_profile.id,
                **iqs_snap,
            },
        )
    )

    if (
        clarify_gate
        and iqs_result.action in ("clarify", "hard_clarify")
        and not iqs_result.skipped
        and not should_bypass_iqs_clarify(user_msg_for_iqs, messages_for_llm)
        and iqs_result.clarification_questions
    ):
        clarify_lines = list(iqs_result.clarification_questions)
        if len(clarify_lines) == 1:
            clarify_text = clarify_lines[0]
        else:
            clarify_text = "\n\n".join(
                f"{i}. {q}" for i, q in enumerate(clarify_lines, start=1)
            )
        if clarify_text:
            streamed_parts.append(clarify_text)
            out_chars_delta += len(clarify_text)
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="iqs_clarify",
                payload={
                    **iqs_snap,
                    "clarification_questions": clarify_lines,
                },
            )
        )
        if clarify_text:
            await run.append(
                StreamEnvelope(
                    phase=PHASE_LLM,
                    kind="delta",
                    text=clarify_text,
                    payload={"iqs_action": iqs_result.action},
                )
            )
        return RunPreamble(
            short_circuit=True,
            out_chars_delta=out_chars_delta,
            run_principal=run_principal,
            coach_endpoint=coach_endpoint,
            iqs_snap=iqs_snap,
        )

    pipeline_snap = merge_vault_chat_sources_into_snapshot(
        build_minimal_pipeline_snapshot(),
        list(req.vault_source_ids or []),
        [r.model_dump() for r in (req.vault_source_refs or [])],
    )

    if clarify_gate:
        if iqs_result.action in ("pass", "assume_defaults"):
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text="plan_build_start",
                    payload={},
                )
            )
            plan, plan_ms = await _timed_plan()
            _record_plan_phase(plan_ms)
            plan = await _maybe_recall_crystallized_plan(iqs_result, plan)
        else:
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text="plan_build_start",
                    payload={},
                )
            )
            plan, plan_ms = await _timed_plan()
            _record_plan_phase(plan_ms)
    else:
        plan = await _maybe_recall_crystallized_plan(iqs_result, plan)

    from oaao_orchestrator.chat_helpers import _chat_completions_url
    from oaao_orchestrator.endpoint import maybe_downgrade_planner_mode, pick_base_url
    from oaao_orchestrator.planner_modes import refine_plan_for_mode

    planner_mode_id = str(getattr(req, "planner_mode_id", None) or "default")
    endpoint_cfg: dict[str, Any] = {}
    ep_obj = getattr(req, "endpoint", None)
    if ep_obj is not None:
        if hasattr(ep_obj, "model_dump"):
            endpoint_cfg = dict(ep_obj.model_dump())
        elif isinstance(ep_obj, dict):
            endpoint_cfg = dict(ep_obj)
        else:
            base = str(getattr(ep_obj, "base_url", "") or "")
            endpoint_cfg = {"base_url": base, "base_urls": getattr(ep_obj, "base_urls", None)}
    downgraded, downgrade_note = maybe_downgrade_planner_mode(planner_mode_id, endpoint_cfg)
    if downgrade_note:
        planner_mode_id = downgraded
        setattr(req, "planner_mode_id", planner_mode_id)
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind=KIND_STATUS,
                text="planner_mode_downgraded",
                payload={"from": downgrade_note.split("->")[0], "to": "default", "reason": "box1_unhealthy"},
            )
        )

    main_base = (
        pick_base_url(
            endpoint_cfg,
            ctx={
                "planner_mode_id": planner_mode_id,
                "purpose_id": str(getattr(req, "purpose_id", None) or "chat"),
            },
        )
        if endpoint_cfg
        else ""
    )
    if not main_base and ep_obj is not None:
        main_base = str(getattr(ep_obj, "base_url", "") or "")
    main_llm_url = _chat_completions_url(main_base) if main_base else planner_url
    main_model = str(getattr(ep_obj, "model", None) or planner_model or "")

    plan, planner_mode_meta = await refine_plan_for_mode(
        plan,
        req=req,
        mode_id=planner_mode_id,
        chat_completions_url=planner_url,
        api_key=planner_api_key,
        model=planner_model,
        allowed_agents=allowed_agents,
        main_llm_url=main_llm_url,
        main_api_key=api_key,
        main_model=main_model,
        coach_endpoint=coach_endpoint,
        run=run,
    )
    if planner_mode_meta.get("mode") in ("tot", "ddtree"):
        iqs_snap["planner_mode_meta"] = planner_mode_meta
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind=KIND_STATUS,
                text=f"planner_mode_{planner_mode_meta.get('mode')}",
                payload=planner_mode_meta,
            )
        )

    task_queue: list[RunTaskSpec] = list(plan.tasks)
    report_after_ids = set(plan.report_after_task_ids)
    pipeline_timing["thinking_ms"] = _elapsed_ms_since(t_start)

    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind=KIND_STATUS,
            text="preflight_timing",
            payload={"pipeline_timing": dict(pipeline_timing)},
        )
    )

    await emit_task_list_status(
        run, plan, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap, text="task_plan"
    )

    scope_docs: dict[int, list[int]] = {}
    for raw_vid, raw_ids in (req.vault_scope_documents or {}).items():
        try:
            vid = int(raw_vid)
        except (TypeError, ValueError):
            continue
        if vid < 1 or not isinstance(raw_ids, list):
            continue
        clean_ids: list[int] = []
        for x in raw_ids:
            try:
                did = int(x)
            except (TypeError, ValueError):
                continue
            if did > 0:
                clean_ids.append(did)
        if clean_ids:
            scope_docs[vid] = sorted(set(clean_ids))

    slide_designer_cfg = req.slide_designer if isinstance(req.slide_designer, dict) else {}
    if isinstance(getattr(plan, "slide_designer", None), dict):
        slide_designer_cfg = dict(plan.slide_designer)
    if isinstance(slide_designer_cfg, dict) and (
        slide_designer_cfg.get("start_new_deck") or slide_designer_cfg.get("regenerate_deck")
    ):
        slide_designer_cfg = dict(slide_designer_cfg)
        slide_designer_cfg.pop("resume_project_id", None)
        slide_designer_cfg.pop("continuation", None)
    run_ctx_extra: dict[str, Any] = {
        "allowed_agents": allowed_agents,
        "assistant_message_id": req.assistant_message_id,
        "workspace_id": req.workspace_id,
        "planner_mode_id": planner_mode_id,
        "llm_url": planner_url,
        "llm_api_key": api_key,
        "llm_model": planner_model,
        "slide_designer": slide_designer_cfg,
        "vault_rag": _vault_rag_ctx_extra(
            req,
            scope_docs=scope_docs,
            pipeline_snap=pipeline_snap,
            plan=plan,
        ),
        "chat_attachments": list(getattr(req, "chat_attachments", None) or []),
    }
    if isinstance(getattr(req, "mm_understand", None), dict):
        run_ctx_extra["mm_understand"] = dict(req.mm_understand)
    if isinstance(getattr(req, "mm_generate", None), dict):
        run_ctx_extra["mm_generate"] = dict(req.mm_generate)
    if isinstance(getattr(req, "mm_edit", None), dict):
        run_ctx_extra["mm_edit"] = dict(req.mm_edit)
    if run_principal is not None:
        run_ctx_extra["run_principal"] = run_principal
    run_ctx = RunContext(
        conversation_id=req.conversation_id,
        user_id=req.user_id,
        purpose_id=req.purpose_id,
        mode_id=req.mode_id,
        messages=list(messages_for_llm),
        model=req.endpoint.model,
        extra=run_ctx_extra,
    )

    return RunPreamble(
        short_circuit=False,
        out_chars_delta=out_chars_delta,
        run_principal=run_principal,
        coach_endpoint=coach_endpoint,
        iqs_snap=iqs_snap,
        pipeline_snap=pipeline_snap,
        plan=plan,
        run_ctx=run_ctx,
        task_queue=task_queue,
        report_after_ids=report_after_ids,
        scope_docs=scope_docs,
    )
