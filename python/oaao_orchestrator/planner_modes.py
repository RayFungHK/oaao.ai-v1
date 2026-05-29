"""ToT / DDTree planner expansions (Audit §7.6)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.planner_llm import (
    PlannerOutputDraft,
    PlannerTaskDraft,
    _extract_json_object,
    llm_chat_completion_text,
    planner_output_to_run_plan,
)
from oaao_orchestrator.tasks.models import RunPlan, RunTaskType

logger = logging.getLogger(__name__)

TOT_CANDIDATES = 3
DDTREE_BRANCHES = 3
DDTREE_MAX_DEPTH = 3


def apply_mode_expansion(plan: RunPlan, *, mode_id: str) -> RunPlan:
    """No-op marker expansion — real branching happens in ``refine_plan_for_mode``."""
    return plan


def _score_plan_heuristic(plan: RunPlan, *, user_message: str, require_vault: bool) -> float:
    """Lightweight plan ranking — higher is better."""
    score = 0.0
    types = {t.type for t in plan.tasks}
    agents = {(t.agent_kind or "").strip() for t in plan.tasks if t.type == RunTaskType.AGENT}
    if RunTaskType.LLM_STREAM in types:
        score += 0.25
    if require_vault and RunTaskType.VAULT_RAG in types:
        score += 0.35
    elif not require_vault:
        score += 0.1
    score += min(0.25, 0.05 * len(agents))
    score += min(0.15, 0.03 * len(plan.tasks))
    um = (user_message or "").lower()
    for spec in plan.tasks:
        title = (spec.title or "").lower()
        if title and any(tok in um for tok in title.split()[:4] if len(tok) > 3):
            score += 0.05
    return score


def _draft_from_plan(plan: RunPlan) -> PlannerOutputDraft:
    tasks = [
        PlannerTaskDraft(
            id=t.id,
            title=t.title,
            type=str(t.type.value if hasattr(t.type, "value") else t.type),
            agent_kind=t.agent_kind,
            requires_ask=bool((t.params or {}).get("requires_ask")),
            ask_message=(t.params or {}).get("ask_message") if isinstance(t.params, dict) else None,
        )
        for t in plan.tasks
    ]
    return PlannerOutputDraft(
        tasks=tasks,
        abilities=list(plan.abilities),
        report_after=list(plan.report_after_task_ids),
    )


async def _llm_json(
    *,
    system: str,
    user: str,
    url: str,
    api_key: str | None,
    model: str,
) -> dict[str, Any] | None:
    text = await llm_chat_completion_text(
        url=url,
        api_key=api_key,
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        timeout_s=45.0,
    )
    if not text:
        return None
    return _extract_json_object(text)


async def _tot_alternative_drafts(
    req: object,
    base: PlannerOutputDraft,
    *,
    url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str],
) -> list[PlannerOutputDraft]:
    from oaao_orchestrator.planner_llm import _last_user_message

    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    base_json = base.model_dump()
    system = (
        "You are a Tree-of-Thought planner. Output ONLY JSON.\n"
        f'Schema: {{"candidates": [{{"strategy": "short label", "tasks": [... same task schema as input ...]}}]}}\n'
        f"Produce exactly {TOT_CANDIDATES - 1} alternative task strategies (different agent order or emphasis).\n"
        f"Allowed agents: {', '.join(allowed_agents) or 'none'}.\n"
        "Each candidate must end with one llm_stream task."
    )
    obj = await _llm_json(
        system=system,
        user=f"Base plan:\n{base_json}\n\nUser message:\n{user_msg[:3000]}",
        url=url,
        api_key=api_key,
        model=model,
    )
    if not obj:
        return [base]
    out: list[PlannerOutputDraft] = [base]
    raw = obj.get("candidates")
    if not isinstance(raw, list):
        return out
    for row in raw[: TOT_CANDIDATES - 1]:
        if not isinstance(row, dict):
            continue
        tasks_raw = row.get("tasks")
        if not isinstance(tasks_raw, list):
            continue
        try:
            draft = PlannerOutputDraft.model_validate(
                {"tasks": tasks_raw, "abilities": base.abilities, "report_after": base.report_after}
            )
            out.append(draft)
        except Exception:  # noqa: BLE001
            continue
    return out[:TOT_CANDIDATES]


async def _ddtree_pick_branch(
    req: object,
    *,
    url: str,
    api_key: str | None,
    model: str,
) -> tuple[str, float]:
    from oaao_orchestrator.evaluation.iqs import score_iqs
    from oaao_orchestrator.planner_llm import _last_user_message

    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    system = (
        "You are a DDTree planner. Output ONLY JSON.\n"
        f'Schema: {{"branches": [{{"question": "clarifying sub-goal", "approach": "one sentence plan angle"}}]}}\n'
        f"Produce exactly {DDTREE_BRANCHES} distinct branches for the user turn."
    )
    obj = await _llm_json(
        system=system,
        user=f"User message:\n{user_msg[:3000]}",
        url=url,
        api_key=api_key,
        model=model,
    )
    best_q = user_msg
    best_score = 0.0
    branches = obj.get("branches") if isinstance(obj, dict) else None
    if not isinstance(branches, list):
        return user_msg, 0.0
    for row in branches:
        if not isinstance(row, dict):
            continue
        approach = str(row.get("approach") or row.get("question") or "").strip()
        if not approach:
            continue
        probe = f"{user_msg}\n\nPlanning angle: {approach}"
        result = await score_iqs(user_message=probe, conversation_history=[], inline=True)
        if float(result.score) > best_score:
            best_score = float(result.score)
            best_q = probe
    return best_q, best_score


def _plan_tasks_summary(plan: RunPlan) -> str:
    lines: list[str] = []
    for spec in plan.tasks:
        tname = str(spec.type.value if hasattr(spec.type, "value") else spec.type)
        extra = f" agent={spec.agent_kind}" if spec.agent_kind else ""
        lines.append(f"- {tname}: {spec.title}{extra}")
    return "\n".join(lines) if lines else "- llm_stream: respond"


async def _execute_tot_candidate_probe(
    plan: RunPlan,
    *,
    user_msg: str,
    messages: list[dict[str, Any]],
    main_llm_url: str,
    api_key: str | None,
    model: str,
) -> str:
    """Run a lightweight 31B probe for one ToT candidate (Audit §7.6)."""
    system = (
        "You are the main assistant executing a planned task pipeline. "
        "Follow the plan steps and produce the final user-facing answer."
    )
    user = (
        f"User request:\n{user_msg}\n\nPlanned steps:\n{_plan_tasks_summary(plan)}\n\n"
        "Provide the complete answer."
    )
    ctx_msgs: list[dict[str, str]] = []
    for row in messages[-6:]:
        if isinstance(row, dict):
            role = str(row.get("role") or "user")
            content = str(row.get("content") or "")
            if content.strip():
                ctx_msgs.append({"role": role, "content": content})
    probe_msgs = [{"role": "system", "content": system}, *ctx_msgs, {"role": "user", "content": user}]
    text = await llm_chat_completion_text(
        url=main_llm_url,
        api_key=api_key,
        model=model,
        messages=probe_msgs,
        temperature=0.3,
        timeout_s=90.0,
    )
    return text or ""


async def _pick_tot_plan_by_accs(
    candidates: list[RunPlan],
    *,
    user_msg: str,
    messages: list[dict[str, Any]],
    main_llm_url: str,
    api_key: str | None,
    model: str,
    coach_endpoint: dict[str, Any] | None,
    run: Any | None = None,
) -> tuple[RunPlan, dict[str, Any]]:
    from oaao_orchestrator.evaluation.accs import score_accs
    from oaao_orchestrator.streaming.events import KIND_STATUS, PHASE_SYSTEM, StreamEnvelope

    scored: list[tuple[float, int, RunPlan, dict[str, Any]]] = []
    candidate_scores: list[dict[str, Any]] = []
    for idx, plan in enumerate(candidates):
        probe_out = await _execute_tot_candidate_probe(
            plan,
            user_msg=user_msg,
            messages=messages,
            main_llm_url=main_llm_url,
            api_key=api_key,
            model=model,
        )
        accs = await score_accs(
            user_message=user_msg,
            llm_output=probe_out,
            coach_endpoint=coach_endpoint,
        )
        row = {
            "index": idx,
            "accs_score": round(float(accs.score), 4),
            "accs_action": accs.action,
        }
        candidate_scores.append(row)
        scored.append((float(accs.score), idx, plan, row))
        if run is not None:
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text="tot_candidate_scored",
                    payload=row,
                )
            )
    scored.sort(key=lambda x: -x[0])
    best_score, best_idx, best_plan, best_row = scored[0]
    meta = {
        "tot_candidates": len(candidates),
        "tot_selected_index": best_idx,
        "tot_selected_score": round(best_score, 4),
        "tot_selection": "accs",
        "tot_candidate_scores": candidate_scores,
        "tot_selected_accs_action": best_row.get("accs_action"),
    }
    logger.info(
        "planner_tot accs selected=%s score=%.3f of %s",
        best_idx,
        best_score,
        len(candidates),
    )
    return best_plan, meta


async def _ddtree_expand(
    req: object,
    plan: RunPlan,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict[str, Any]],
    depth: int = 0,
    meta: dict[str, Any] | None = None,
) -> tuple[RunPlan, dict[str, Any]]:
    """Expand DDTree up to ``DDTREE_MAX_DEPTH`` with IQS-filtered branches."""
    from oaao_orchestrator.planner import build_run_plan
    from oaao_orchestrator.planner_llm import _last_user_message

    meta = dict(meta or {})
    meta["ddtree_depth"] = depth
    user_msg = _last_user_message(messages)
    branch_msg, branch_iqs = await _ddtree_pick_branch(
        req,
        url=chat_completions_url,
        api_key=api_key,
        model=model,
    )
    meta[f"ddtree_branch_iqs_d{depth}"] = round(branch_iqs, 4)
    if branch_msg == user_msg:
        meta["ddtree_replanned"] = False
        return plan, meta

    class _ReqMessagesProxy:
        __slots__ = ("_base", "_messages")

        def __init__(self, base: object, msgs: list[dict[str, Any]]) -> None:
            self._base = base
            self._messages = msgs

        def __getattr__(self, name: str) -> Any:
            return getattr(self._base, name)

        @property
        def messages(self) -> list[dict[str, Any]]:
            return self._messages

    patched = list(messages)
    if patched and str(patched[-1].get("role") or "").lower() == "user":
        patched[-1] = {**patched[-1], "content": branch_msg}
    else:
        patched.append({"role": "user", "content": branch_msg})

    replanned = await build_run_plan(
        _ReqMessagesProxy(req, patched),
        chat_completions_url=chat_completions_url,
        api_key=api_key,
        model=model,
    )
    if not replanned.tasks:
        meta["ddtree_replanned"] = False
        return plan, meta

    meta["ddtree_replanned"] = True
    if depth + 1 >= DDTREE_MAX_DEPTH:
        return replanned, meta
    return await _ddtree_expand(
        req,
        replanned,
        chat_completions_url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=patched,
        depth=depth + 1,
        meta=meta,
    )


async def refine_plan_for_mode(
    plan: RunPlan,
    *,
    req: object,
    mode_id: str,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str],
    main_llm_url: str | None = None,
    main_api_key: str | None = None,
    main_model: str | None = None,
    coach_endpoint: dict[str, Any] | None = None,
    run: Any | None = None,
) -> tuple[RunPlan, dict[str, Any]]:
    """Select or expand plan for ``tot`` or ``ddtree`` modes."""
    mode = (mode_id or "default").strip().lower()
    meta: dict[str, Any] = {"mode": mode}
    if mode not in ("tot", "ddtree"):
        return plan, meta

    from oaao_orchestrator.planner import _vault_rag_needed
    from oaao_orchestrator.planner_llm import _last_user_message

    require_vault = _vault_rag_needed(req)
    require_attachments = bool(getattr(req, "chat_attachments", None) or [])
    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    messages = list(getattr(req, "messages", []) or [])
    sd_cfg = getattr(req, "slide_designer", None)
    slide_cfg = sd_cfg if isinstance(sd_cfg, dict) else None
    conv_materials = getattr(req, "conversation_materials", None)

    if mode == "tot":
        base_draft = _draft_from_plan(plan)
        drafts = await _tot_alternative_drafts(
            req,
            base_draft,
            url=chat_completions_url,
            api_key=api_key,
            model=model,
            allowed_agents=allowed_agents,
        )
        candidates: list[RunPlan] = []
        for draft in drafts:
            candidates.append(
                planner_output_to_run_plan(
                    draft,
                    allowed_agents=allowed_agents,
                    require_vault=require_vault,
                    require_attachments=require_attachments,
                    messages=messages,
                    slide_designer_cfg=slide_cfg,
                    conv_materials=conv_materials if isinstance(conv_materials, list) else None,
                    req=req,
                )
            )
        if main_llm_url and main_model:
            best_plan, tot_meta = await _pick_tot_plan_by_accs(
                candidates,
                user_msg=user_msg,
                messages=messages,
                main_llm_url=main_llm_url,
                api_key=main_api_key,
                model=main_model,
                coach_endpoint=coach_endpoint,
                run=run,
            )
            meta.update(tot_meta)
            return best_plan, meta
        scored = [
            (_score_plan_heuristic(p, user_message=user_msg, require_vault=require_vault), i, p)
            for i, p in enumerate(candidates)
        ]
        scored.sort(key=lambda x: -x[0])
        best_score, best_idx, best_plan = scored[0]
        meta.update(
            {
                "tot_candidates": len(candidates),
                "tot_selected_index": best_idx,
                "tot_selected_score": round(best_score, 4),
                "tot_selection": "heuristic",
            }
        )
        logger.info(
            "planner_tot heuristic selected=%s score=%.3f of %s",
            best_idx,
            best_score,
            len(candidates),
        )
        return best_plan, meta

    return await _ddtree_expand(
        req,
        plan,
        chat_completions_url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=messages,
        depth=0,
        meta=meta,
    )
