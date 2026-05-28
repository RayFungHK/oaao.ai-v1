"""Run planner — stub checklist (Phase 1) or LLM planner (Phase 2)."""

from __future__ import annotations

import logging

from oaao_orchestrator.planner_catalog import (
    DEFAULT_ALLOWED_AGENTS,
    ability_hints_for,
    catalog_from_request,
)
from oaao_orchestrator.planner_llm import (
    apply_slide_continuation_to_specs,
    apply_slide_fanout_to_specs,
    apply_template_deck_plan_adjustments,
    enrich_composer_web_search_plan,
    ensure_slide_designer_requires_ask,
    inject_slide_designer_for_teaching_intent,
    inject_web_search_for_planner_intent,
    plan_run_with_llm,
    planner_enabled,
)
from oaao_orchestrator.slide_project.conversation_intent import (
    text_signals_personal_record_lookup,
    text_signals_vault_grounding,
    wants_multi_agent_for_slides,
)
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType

logger = logging.getLogger(__name__)


def _vault_rag_needed(req: object) -> bool:
    attachments = getattr(req, "chat_attachments", None) or []
    has_attachments = bool(attachments)
    auto_rag = bool(getattr(req, "vault_auto_rag", False))
    explicit_scope = bool(
        getattr(req, "vault_source_refs", None)
        or getattr(req, "vault_source_ids", None)
        or getattr(req, "vault_scope_documents", None)
    )
    for msg in reversed(getattr(req, "messages", None) or []):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "").lower() != "user":
            continue
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        if text_signals_vault_grounding(content) or text_signals_personal_record_lookup(content):
            return True

    # Composer uploads for this turn — auto vault search adds conflicting zero-hit prompts.
    if has_attachments and auto_rag and not explicit_scope:
        return False

    return auto_rag or explicit_scope


def _composer_auto_vault_rag(req: object) -> bool:
    """Composer Auto Source (vault_auto_rag, no manual picks) — route via LLM planner."""
    auto_rag = bool(getattr(req, "vault_auto_rag", False))
    if not auto_rag:
        return False
    return not _explicit_vault_scope(req)


def _explicit_vault_scope(req: object) -> bool:
    return bool(
        getattr(req, "vault_source_refs", None)
        or getattr(req, "vault_source_ids", None)
        or getattr(req, "vault_scope_documents", None)
    )


def _public_web_turn(req: object) -> bool:
    """Composer globe and/or planning.intent hook selected public-web routing."""
    if bool(getattr(req, "enable_web_search", False)):
        return True
    turn_intent = getattr(req, "turn_intent", None)
    return isinstance(turn_intent, dict) and bool(turn_intent.get("needs_web_search"))


def strip_vault_rag_for_public_web(specs: list[RunTaskSpec], req: object) -> list[RunTaskSpec]:
    """Drop knowledge-base retrieval when this turn is web-only (Auto Source must not force vault)."""
    if not _public_web_turn(req) or _explicit_vault_scope(req):
        return specs
    out = [s for s in specs if s.type != RunTaskType.VAULT_RAG]
    total = len(out)
    for idx, spec in enumerate(out, start=1):
        spec.index = idx
        spec.total = total
    return out


def finalize_public_web_plan(plan: RunPlan, req: object, *, allowed_agents: list[str]) -> RunPlan:
    """Ensure web_search is scheduled and vault_rag omitted for public-web turns."""
    if not _public_web_turn(req) or _explicit_vault_scope(req):
        return plan
    tasks = strip_vault_rag_for_public_web(list(plan.tasks), req)
    tasks = inject_web_search_for_planner_intent(
        tasks,
        allowed_agents=allowed_agents,
        needs_web_search=True,
    )
    plan.tasks = tasks
    total = len(plan.tasks)
    for idx, spec in enumerate(plan.tasks, start=1):
        spec.index = idx
        spec.total = total
    if not plan.abilities:
        plan.abilities = ability_hints_for(
            [t.agent_kind for t in plan.tasks if t.agent_kind] or ["web_search"],
        )
    return plan


def resolve_allowed_agents(req: object) -> list[str]:
    raw = getattr(req, "allowed_agents", None) or []
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if str(x).strip()]
    return list(DEFAULT_ALLOWED_AGENTS)


def needs_multi_agent_turn(req: object) -> bool:
    """True when the turn needs LLM planner + slide/web agents (not plain Q&A).

    Composer globe alone uses :func:`build_composer_web_fast_plan` (web_search → llm_stream).
    """
    if bool(getattr(req, "enable_web_search", False)):
        return False
    if _composer_auto_vault_rag(req):
        return True
    # Ephemeral attachments use deterministic rt-attachments — not LLM planner.
    sd = getattr(req, "slide_designer", None)
    if isinstance(sd, dict):
        for key in ("template_id", "continuation", "regenerate_deck", "regenerate"):
            if sd.get(key):
                return True
    if wants_multi_agent_for_slides(req):
        return True
    return False


def _build_core_run_tasks(req: object) -> tuple[list[RunTaskSpec], list[str]]:
    specs: list[RunTaskSpec] = []
    report_after: list[str] = []
    if _vault_rag_needed(req):
        specs.append(
            RunTaskSpec(
                id="rt-vault-rag",
                title="Search knowledge base",
                type=RunTaskType.VAULT_RAG,
            )
        )
        report_after.append("rt-vault-rag")
    attachments = getattr(req, "chat_attachments", None) or []
    if attachments:
        specs.append(
            RunTaskSpec(
                id="rt-attachments",
                title="Process attachments",
                type=RunTaskType.ATTACHMENTS,
            )
        )
    specs.append(
        RunTaskSpec(
            id="rt-llm-stream",
            title="Compose reply",
            type=RunTaskType.LLM_STREAM,
        )
    )
    return specs, report_after


def _finalize_run_plan(
    specs: list[RunTaskSpec],
    *,
    report_after: list[str],
    hint_kinds: list[str] | None = None,
) -> RunPlan:
    total = len(specs)
    for i, spec in enumerate(specs, start=1):
        spec.index = i
        spec.total = total
    kinds = hint_kinds or [s.agent_kind for s in specs if s.agent_kind]
    return RunPlan(
        tasks=specs,
        abilities=ability_hints_for(kinds),
        report_after_task_ids=report_after,
    )


def build_fast_chat_plan(req: object) -> RunPlan:
    """
    Deterministic vault → compose path for normal Q&A.

    Skips the LLM planner round-trip and slide_designer injection.
    """
    specs, _report_after = _build_core_run_tasks(req)
    hint_kinds = [s.agent_kind for s in specs if s.agent_kind]
    if not hint_kinds and _vault_rag_needed(req):
        hint_kinds = ["vault_rag"]
    return _finalize_run_plan(specs, report_after=[], hint_kinds=hint_kinds)


def build_composer_web_fast_plan(req: object) -> RunPlan:
    """Composer globe on — run web_search then compose without LLM planner or agent ask."""
    specs, report_after = _build_core_run_tasks(req)
    specs = [
        s
        for s in specs
        if s.type not in (RunTaskType.LLM_STREAM, RunTaskType.VAULT_RAG)
    ]
    allowed = resolve_allowed_agents(req)
    specs = inject_web_search_for_planner_intent(
        specs,
        allowed_agents=allowed,
        needs_web_search=True,
    )
    specs.append(
        RunTaskSpec(
            id="rt-llm-stream",
            title="Compose reply",
            type=RunTaskType.LLM_STREAM,
        )
    )
    hint_kinds = [s.agent_kind for s in specs if s.agent_kind] or ["web_search"]
    return _finalize_run_plan(specs, report_after=report_after, hint_kinds=hint_kinds)


def build_default_run_plan(req: object) -> RunPlan:
    """
    Phase 1 checklist — ``vault_rag`` (when scoped) → optional ``attachments`` → ``llm_stream``.
    """
    specs, report_after = _build_core_run_tasks(req)

    allowed = resolve_allowed_agents(req)
    sd_cfg = getattr(req, "slide_designer", None)
    slide_cfg = sd_cfg if isinstance(sd_cfg, dict) else None
    specs = inject_slide_designer_for_teaching_intent(
        specs,
        allowed_agents=allowed,
        messages=list(getattr(req, "messages", []) or []),
        slide_designer_cfg=slide_cfg,
    )
    specs = ensure_slide_designer_requires_ask(
        specs,
        messages=list(getattr(req, "messages", []) or []),
        slide_designer_cfg=slide_cfg,
    )
    specs = apply_slide_continuation_to_specs(specs, slide_cfg)
    specs = apply_slide_fanout_to_specs(specs, list(getattr(req, "messages", []) or []), slide_cfg)
    specs = apply_template_deck_plan_adjustments(specs, slide_cfg)
    specs = inject_web_search_for_planner_intent(
        specs,
        allowed_agents=allowed,
        needs_web_search=bool(getattr(req, "enable_web_search", False)),
    )

    hint_kinds = [s.agent_kind for s in specs if s.agent_kind]
    if not hint_kinds and _vault_rag_needed(req):
        hint_kinds = ["vault_rag"]
    return _finalize_run_plan(specs, report_after=report_after, hint_kinds=hint_kinds)


def apply_turn_intent_to_plan(plan: RunPlan, req: object, *, allowed_agents: list[str]) -> RunPlan:
    """Inject web_search when ``planning.intent`` hook scored public-web need."""
    turn_intent = getattr(req, "turn_intent", None)
    if not isinstance(turn_intent, dict) or not turn_intent.get("needs_web_search"):
        return plan
    tasks = inject_web_search_for_planner_intent(
        list(plan.tasks),
        allowed_agents=allowed_agents,
        needs_web_search=True,
    )
    plan.tasks = tasks
    total = len(plan.tasks)
    for idx, spec in enumerate(plan.tasks, start=1):
        spec.index = idx
        spec.total = total
    return plan


async def build_run_plan(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
) -> RunPlan:
    """LLM planner when enabled; fall back to deterministic default on any failure."""
    from oaao_orchestrator.chat_helpers import _chat_completions_url, resolve_api_key_env_dict
    from oaao_orchestrator.turn_intent import apply_turn_intent_hook

    intent_payload = getattr(req, "planner_intent", None)
    if isinstance(intent_payload, dict):
        intent_base = str(intent_payload.get("base_url") or "").strip()
        intent_model = str(intent_payload.get("model") or model).strip()
        intent_key = resolve_api_key_env_dict(intent_payload)
        if intent_base and intent_model:
            await apply_turn_intent_hook(
                req,
                chat_completions_url=_chat_completions_url(intent_base),
                api_key=intent_key,
                model=intent_model,
            )

    if not needs_multi_agent_turn(req):
        if bool(getattr(req, "enable_web_search", False)):
            logger.info("run_planner_composer_web_fast")
            return finalize_public_web_plan(
                build_composer_web_fast_plan(req),
                req,
                allowed_agents=resolve_allowed_agents(req),
            )
        turn_intent = getattr(req, "turn_intent", None)
        if isinstance(turn_intent, dict) and turn_intent.get("needs_web_search"):
            logger.info("run_planner_turn_intent_web_fast")
            return finalize_public_web_plan(
                build_composer_web_fast_plan(req),
                req,
                allowed_agents=resolve_allowed_agents(req),
            )
        logger.info("run_planner_fast_chat vault_rag=%s", _vault_rag_needed(req))
        return build_fast_chat_plan(req)

    allowed = resolve_allowed_agents(req)
    if planner_enabled(req):
        try:
            planned = await plan_run_with_llm(
                req,
                chat_completions_url=chat_completions_url,
                api_key=api_key,
                model=model,
                allowed_agents=allowed,
            )
            if planned is not None and planned.tasks:
                if not planned.abilities:
                    cat = catalog_from_request(req)
                    planned.abilities = ability_hints_for(
                        [t.agent_kind for t in planned.tasks if t.agent_kind] or allowed[:3],
                        catalog=cat,
                    )
                planned = enrich_composer_web_search_plan(
                    planned,
                    req,
                    allowed_agents=allowed,
                )
                planned = apply_turn_intent_to_plan(planned, req, allowed_agents=allowed)
                return finalize_public_web_plan(planned, req, allowed_agents=allowed)
        except Exception:
            logger.exception("llm_planner_failed")
    planned = enrich_composer_web_search_plan(
        build_default_run_plan(req),
        req,
        allowed_agents=allowed,
    )
    planned = apply_turn_intent_to_plan(planned, req, allowed_agents=allowed)
    return finalize_public_web_plan(planned, req, allowed_agents=allowed)
