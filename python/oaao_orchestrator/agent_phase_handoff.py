"""Between-agent phase summary + inter-agent ask metadata (Phase B/C)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.planner_catalog import catalog_from_request
from oaao_orchestrator.planner_llm import llm_chat_completion_text
from oaao_orchestrator.streaming.events import (
    KIND_DELTA,
    KIND_STATUS,
    PHASE_LLM,
    PHASE_TASK,
    StreamEnvelope,
)
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType
from oaao_orchestrator.tasks.stream_emit import emit_agent_ask, emit_task_list_status

logger = logging.getLogger(__name__)

# Agents that run immediately — no planner requires_ask or inter-agent confirmation.
_AGENTS_RUN_WITHOUT_ASK: frozenset[str] = frozenset({"web_search"})

_PHASE_SUMMARY_SYSTEM = """You write a brief phase summary for a multi-step assistant run.
Output 2-4 sentences in the user's language (zh-Hant if the user wrote Chinese).
Summarize what the completed agent step achieved and what the next specialized agent will do.
Do not ask questions. No markdown headings."""


def peek_next_agent_task(queue: list[RunTaskSpec]) -> RunTaskSpec | None:
    for task in queue:
        if task.type == RunTaskType.AGENT and (task.agent_kind or "").strip():
            return task
    return None


def _agent_display_name(kind: str, *, catalog: dict[str, Any] | None) -> str:
    key = (kind or "").strip()
    if not key:
        return "Agent"
    if catalog and key in catalog:
        entry = catalog[key]
        return (getattr(entry, "name", None) or key).strip() or key
    return key


def fork_recommended_for_agent(*, mode_id: str, agent_kind: str) -> bool:
    """Desk/slide thread running a non-slide agent should offer conversation fork (Phase C)."""
    mode = (mode_id or "default").strip().lower()
    kind = (agent_kind or "").strip().lower()
    if mode != "desk":
        return False
    return kind not in ("slide_designer", "slides")


def prepare_inter_agent_handoff(next_task: RunTaskSpec, *, prior_agent_kind: str) -> None:
    params = dict(next_task.params or {})
    params["inter_agent_handoff"] = True
    params["prior_agent_kind"] = (prior_agent_kind or "").strip()
    next_task.params = params


async def emit_agent_phase_summary(
    run: StreamRun,
    *,
    plan: RunPlan,
    completed_task: RunTaskSpec,
    next_task: RunTaskSpec,
    messages: list[dict[str, Any]],
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    pipeline_snap: dict[str, Any] | None,
    allowed_agents: list[str] | None,
) -> tuple[str, dict[str, Any] | None]:
    """Mini non-stream LLM summary between agent tasks; returns (summary_text, updated_snap)."""
    prior = (completed_task.agent_kind or completed_task.title or "agent").strip()
    nxt = (next_task.agent_kind or next_task.title or "agent").strip()
    user_tail = ""
    for row in reversed(messages):
        if str(row.get("role") or "").lower() == "user":
            c = row.get("content")
            if isinstance(c, str) and c.strip():
                user_tail = c.strip()[:1200]
                break

    prompt = (
        f"Completed step: {prior} (task: {completed_task.title or completed_task.id}).\n"
        f"Next step: {nxt} (task: {next_task.title or next_task.id}).\n"
        f"User request excerpt:\n{user_tail or '(see conversation)'}"
    )
    summary = ""
    try:
        raw = await llm_chat_completion_text(
            url=chat_completions_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": _PHASE_SUMMARY_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
            timeout_s=45.0,
        )
        if raw:
            summary = raw.strip()[:2000]
    except Exception:
        logger.exception("agent_phase_summary_failed completed=%s next=%s", prior, nxt)

    if not summary:
        summary = (
            f"Finished {prior}. Next: {nxt}."
            if user_tail
            else f"Completed {prior}. Continuing with {nxt}."
        )

    header = f"\n\n---\n**{completed_task.title or prior}** ✓\n\n"
    body = header + summary + "\n\n"
    await run.append(
        StreamEnvelope(
            phase=PHASE_LLM,
            kind=KIND_DELTA,
            text=body,
            step_id=completed_task.id,
        ),
    )

    snap = dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {}
    ms = snap.get("milestone") if isinstance(snap.get("milestone"), dict) else {}
    steps = list(ms.get("steps") or []) if isinstance(ms.get("steps"), list) else []
    steps.append(
        {
            "title": f"{prior} complete",
            "description": summary[:500],
            "state": "completed",
            "rail": {"badge": "Phase summary", "detail_lines": [summary[:120]]},
        },
    )
    snap["milestone"] = {"steps": steps[-12:]}
    await run.append(
        StreamEnvelope(
            phase=PHASE_TASK,
            kind=KIND_STATUS,
            text="agent_phase_summary",
            step_id=completed_task.id,
            payload={"oaao_pipeline": snap, "phase_summary": summary},
        ),
    )
    return summary, snap


async def maybe_inter_agent_handoff(
    run: StreamRun,
    req: object,
    *,
    plan: RunPlan,
    completed_task: RunTaskSpec,
    task_queue: list[RunTaskSpec],
    messages: list[dict[str, Any]],
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    pipeline_snap: dict[str, Any] | None,
    allowed_agents: list[str] | None,
) -> dict[str, Any] | None:
    """After an agent task succeeds, summarize and mark the next agent for inter-agent ask."""
    if completed_task.type != RunTaskType.AGENT:
        return pipeline_snap
    next_ag = peek_next_agent_task(task_queue)
    if next_ag is None:
        return pipeline_snap
    next_kind = (next_ag.agent_kind or "").strip()
    if next_kind in _AGENTS_RUN_WITHOUT_ASK:
        return pipeline_snap
    prior = (completed_task.agent_kind or "").strip()
    prepare_inter_agent_handoff(next_ag, prior_agent_kind=prior)
    _, updated = await emit_agent_phase_summary(
        run,
        plan=plan,
        completed_task=completed_task,
        next_task=next_ag,
        messages=messages,
        chat_completions_url=chat_completions_url,
        api_key=api_key,
        model=model,
        pipeline_snap=pipeline_snap,
        allowed_agents=allowed_agents,
    )
    await emit_task_list_status(
        run,
        plan,
        allowed_agents=allowed_agents,
        pipeline_snap=updated,
        text="agent_phase_handoff",
    )
    return updated


def resolve_agent_ask_prompt(
    run_task: RunTaskSpec,
    req: object | None,
    *,
    run_ctx_extra: dict[str, Any] | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """
    Whether to show agent ask before running this task.

    Combines planner ``requires_ask`` and runtime inter-agent handoff (Phase B/C).
    """
    from oaao_orchestrator.agent_ask import task_needs_user_ask

    if run_task.type != RunTaskType.AGENT:
        return False, "", None

    kind = (run_task.agent_kind or "").strip()
    if kind in _AGENTS_RUN_WITHOUT_ASK:
        return False, "", None
    cat = catalog_from_request(req)
    mode_id = str(getattr(req, "mode_id", None) or "default")
    inter = bool((run_task.params or {}).get("inter_agent_handoff"))
    prior = str((run_task.params or {}).get("prior_agent_kind") or "").strip()

    needs, msg, meta = task_needs_user_ask(run_task, req)
    if not needs and not inter:
        return False, "", None

    if inter and not msg:
        prior_name = _agent_display_name(prior, catalog=cat)
        next_name = _agent_display_name(kind, catalog=cat)
        msg = (
            f"「{prior_name}」已完成。要在此對話繼續執行「{next_name}」嗎？"
            if prior
            else f"要繼續執行「{next_name}」嗎？"
        )

    fork_rec = fork_recommended_for_agent(mode_id=mode_id, agent_kind=kind)
    target_mode = "default" if fork_rec else mode_id
    ask_payload: dict[str, Any] = dict(meta or {})
    ask_payload.update(
        {
            "agent_kind": kind,
            "mode_switch": bool(inter),
            "suggest_fork": fork_rec,
            "fork_recommended": fork_rec,
            "target_mode": target_mode,
            "prior_agent_kind": prior,
        },
    )
    if fork_rec:
        ask_payload["fork_hint"] = (
            "This conversation is in Desk/slide mode. Running this agent here may be awkward — "
            "you can open a new chat for this agent mode or continue in this thread."
        )
    return True, msg, ask_payload


async def emit_inter_agent_ask(
    run: StreamRun,
    plan: RunPlan,
    run_task: RunTaskSpec,
    *,
    message: str,
    ask_meta: dict[str, Any] | None,
    allowed_agents: list[str] | None,
    pipeline_snap: dict[str, Any] | None,
) -> None:
    """Agent ask with Phase C fork fields on the SSE payload."""
    meta = dict(ask_meta or {})
    await emit_agent_ask(
        run,
        plan,
        run_task,
        message=message,
        ask_meta=meta,
        allowed_agents=allowed_agents,
        pipeline_snap=pipeline_snap,
        mode_switch=bool(meta.get("mode_switch")),
        suggest_fork=bool(meta.get("suggest_fork")),
        fork_recommended=bool(meta.get("fork_recommended")),
        target_mode=str(meta.get("target_mode") or "default"),
        prior_agent_kind=str(meta.get("prior_agent_kind") or ""),
        fork_hint=str(meta.get("fork_hint") or ""),
    )
