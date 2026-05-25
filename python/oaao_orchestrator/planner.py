"""Run planner — stub checklist (Phase 1) or LLM planner (Phase 2)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.planner_catalog import (
    DEFAULT_ALLOWED_AGENTS,
    ability_hints_for,
    catalog_from_request,
)
from oaao_orchestrator.planner_llm import (
    _last_user_message,
    _user_wants_handbook_teaching_slides,
    apply_slide_continuation_to_specs,
    apply_slide_fanout_to_specs,
    apply_template_deck_plan_adjustments,
    ensure_slide_designer_requires_ask,
    inject_slide_designer_for_teaching_intent,
    plan_run_with_llm,
    planner_enabled,
)
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType

logger = logging.getLogger(__name__)


def _vault_rag_needed(req: object) -> bool:
    if bool(getattr(req, "vault_auto_rag", False)):
        return True
    refs = getattr(req, "vault_source_refs", None) or []
    if refs:
        return True
    ids = getattr(req, "vault_source_ids", None) or []
    if ids:
        return True
    scope = getattr(req, "vault_scope_documents", None) or {}
    if scope:
        return True
    from oaao_orchestrator.slide_project.teaching_intent import (  # noqa: PLC0415
        text_signals_personal_record_lookup,
        text_signals_vault_grounding,
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
    return False


def resolve_allowed_agents(req: object) -> list[str]:
    raw = getattr(req, "allowed_agents", None) or []
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if str(x).strip()]
    return list(DEFAULT_ALLOWED_AGENTS)


def needs_multi_agent_turn(req: object) -> bool:
    """True when the turn needs LLM planner + slide/web agents (not plain Q&A)."""
    if bool(getattr(req, "enable_web_search", False)):
        return True
    # Ephemeral attachments use deterministic rt-attachments — not LLM planner.
    sd = getattr(req, "slide_designer", None)
    if isinstance(sd, dict):
        for key in ("template_id", "continuation", "regenerate_deck", "regenerate"):
            if sd.get(key):
                return True
    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    if _user_wants_handbook_teaching_slides(user_msg):
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

    hint_kinds = [s.agent_kind for s in specs if s.agent_kind]
    if not hint_kinds and _vault_rag_needed(req):
        hint_kinds = ["vault_rag"]
    return _finalize_run_plan(specs, report_after=report_after, hint_kinds=hint_kinds)


async def build_run_plan(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
) -> RunPlan:
    """LLM planner when enabled; fall back to deterministic default on any failure."""
    if not needs_multi_agent_turn(req):
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
                return planned
        except Exception:
            logger.exception("llm_planner_failed")
    return build_default_run_plan(req)
