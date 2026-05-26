"""Top-20 #6 phase 3 — vault-RAG helpers extracted from ``run_executor``.

These functions used to live inline in ``run_executor.execute_chat_run``'s
preamble. Splitting them out trims the orchestrator's hottest module without
changing call sites — ``run_executor`` now re-imports each helper.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from oaao_orchestrator.run_plan import RunPlan
    from oaao_orchestrator.runtime import RunContext


def vault_rag_ctx_extra(
    req: Any,
    *,
    scope_docs: dict[int, list[int]],
    pipeline_snap: dict[str, Any] | None,
    plan: RunPlan,
) -> dict[str, Any]:
    return {
        "vault_retrieval_profiles": list(getattr(req, "vault_retrieval_profiles", None) or []),
        "embedding": req.embedding if isinstance(getattr(req, "embedding", None), dict) else None,
        "rerank": req.rerank if isinstance(getattr(req, "rerank", None), dict) else None,
        "vault_source_refs": [
            r.model_dump() for r in (getattr(req, "vault_source_refs", None) or [])
        ],
        "vault_scope_documents": scope_docs or None,
        "vault_auto_rag": bool(getattr(req, "vault_auto_rag", False)),
        "vault_document_catalog": dict(getattr(req, "vault_document_catalog", None) or {}),
        "vault_rag_config": req.vault_rag
        if isinstance(getattr(req, "vault_rag", None), dict)
        else None,
        "pipeline_snap_base": dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {},
        "run_plan": plan,
    }


async def apply_vault_rag_agent_result(
    agent_result: Any,
    *,
    messages_for_llm: list[dict[str, Any]],
    run_ctx: RunContext,
    pipeline_snap: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
    if not agent_result.success:
        return messages_for_llm, pipeline_snap, True
    extra = agent_result.extra if isinstance(agent_result.extra, dict) else {}
    msgs = extra.get("messages")
    if isinstance(msgs, list):
        messages_for_llm = list(msgs)
        run_ctx.messages = list(messages_for_llm)
    snap = extra.get("pipeline_snap")
    if isinstance(snap, dict):
        pipeline_snap = snap
    brief = extra.get("vault_grounding_for_slides")
    if isinstance(brief, str) and brief.strip():
        run_ctx.extra["vault_grounding_for_slides"] = brief.strip()
    outcome = extra.get("vault_rag_outcome")
    if isinstance(outcome, dict):
        run_ctx.extra["vault_rag_ran"] = True
        try:
            run_ctx.extra["vault_rag_passage_count"] = int(outcome.get("passage_count") or 0)
        except (TypeError, ValueError):
            run_ctx.extra["vault_rag_passage_count"] = 0
    return messages_for_llm, pipeline_snap, False


def inject_compose_vault_awareness(
    messages: list[dict[str, Any]],
    *,
    req: Any,
    vault_ran: bool,
    passage_count: int,
) -> None:
    """Discourage 'cannot access private vault' when this turn scoped or searched knowledge base."""
    from oaao_orchestrator.slide_project.teaching_intent import (
        text_signals_vault_grounding,
    )
    from oaao_orchestrator.vault_graph_rag import (
        grounding_record_zero_hits_text,
        inject_system_message,
        last_user_query,
        query_wants_meeting_record,
    )

    scoped = bool(
        getattr(req, "vault_auto_rag", False)
        or getattr(req, "vault_source_ids", None)
        or getattr(req, "vault_source_refs", None)
        or getattr(req, "vault_retrieval_profiles", None)
        or getattr(req, "vault_scope_documents", None)
    )

    query = last_user_query(messages)
    handbook_turn = bool(query and text_signals_vault_grounding(query))
    record_turn = bool(query and query_wants_meeting_record(query))

    if passage_count > 0 and record_turn:
        inject_system_message(
            messages,
            "Knowledge-base excerpts are in the system message above (--- Vault excerpts ---). "
            "Answer from those excerpts, citing source labels and dates when shown. "
            "Do not claim you cannot access workspace sources — the excerpts are what was retrieved.",
        )
        return

    if passage_count > 0:
        return
    if not vault_ran and not scoped and not handbook_turn and not record_turn:
        return

    if record_turn and vault_ran:
        inject_system_message(messages, grounding_record_zero_hits_text())
        return

    inject_system_message(
        messages,
        "This turn scoped or ran a knowledge-base (Vault) search. "
        "Do **not** tell the user you cannot access their private vault, knowledge base, or uploaded documents "
        "(不得聲稱無法存取私有 Vault、知識庫或已上傳文件). "
        "If retrieval found no on-topic passages, answer briefly from general knowledge and note that "
        "scoped sources did not match this question — without refusing on access grounds.",
    )
