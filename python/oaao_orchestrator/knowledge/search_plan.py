"""WS-1-S3 (stub) — orientation-driven search plan (not raw user message as sole query)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import _extract_json_object, chat_completion_text
from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.orientation_store import load_effective_orientation
from oaao_orchestrator.knowledge.scope import parse_tenant_id
from oaao_orchestrator.knowledge.search_language import resolve_searxng_language
from oaao_orchestrator.vault_graph_rag import last_user_query

logger = logging.getLogger(__name__)


def _plan_search_language(
    *,
    display_locale: str | None = None,
    orientation: OrientationJsonV1 | None = None,
) -> str | None:
    orient_lang = orientation.language if orientation is not None else None
    return resolve_searxng_language(
        display_locale=display_locale,
        orientation_language=orient_lang,
    )

_SEARCH_PLAN_SYSTEM = """You plan web search queries for oaao.ai global knowledge (tenant / platform scope).
Return ONLY JSON:
{
  "queries": [
    {"q": "search string", "provider": "searxng", "reason": "short why"}
  ],
  "use_user_message_as_fallback": false
}
- Produce 1-4 focused queries from orientation + user turn (not copy-paste of the whole chat).
- Respect do_not_search topics — omit related queries.
- provider must be "searxng" unless orientation specifies another registered id.
- Do not invent URLs."""


def _resolve_search_plan_llm_cfg(
    knowledge: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(knowledge, dict):
        return None
    raw = knowledge.get("search_plan") or knowledge.get("knowledge.search_plan")
    if isinstance(raw, dict) and raw.get("base_url") and raw.get("model"):
        return raw
    return None


def _fallback_queries(
    *,
    user_query: str,
    orientation: OrientationJsonV1 | None,
    max_queries: int = 3,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if orientation is not None:
        for sq in orientation.search_queries_suggested[:max_queries]:
            q = str(sq or "").strip()
            if q:
                out.append(
                    {
                        "q": q,
                        "provider": "searxng",
                        "reason": "orientation_suggested",
                    }
                )
    uq = (user_query or "").strip()
    if uq and len(out) < max_queries:
        out.append({"q": uq[:500], "provider": "searxng", "reason": "user_turn_fallback"})
    return out[:max_queries]


async def build_search_plan(
    *,
    tenant_id: int | None = None,
    workspace_id: int | None = None,
    messages: list[dict[str, Any]],
    knowledge: dict[str, Any] | None = None,
    llm_cfg: dict[str, Any] | None = None,
    display_locale: str | None = None,
) -> dict[str, Any]:
    """
    Build a search plan for ``WebSearchAgent``.

    Returns ``{version, method, queries[], orientation_snapshot?}``.
    """
    user_query = last_user_query(list(messages or []))
    tid = parse_tenant_id(tenant_id)
    if tid is None and isinstance(knowledge, dict):
        tid = parse_tenant_id(knowledge.get("tenant_id"))
    orientation = load_effective_orientation(tenant_id=tid, workspace_id=workspace_id)
    search_language = _plan_search_language(
        display_locale=display_locale,
        orientation=orientation,
    )
    llm_cfg = llm_cfg or _resolve_search_plan_llm_cfg(knowledge)

    if llm_cfg and user_query:
        orient_blob = orientation.model_dump() if orientation else {}
        user_blob = (
            f"tenant_id={tid}\n"
            f"contributing_workspace_id={workspace_id}\n"
            f"user_query={user_query[:800]}\n"
            f"effective_orientation_json={orient_blob}\n"
        )
        async with httpx.AsyncClient() as client:
            raw_text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=_SEARCH_PLAN_SYSTEM,
                user=user_blob,
                temperature=0.15,
                timeout_sec=45.0,
            )
        parsed = _extract_json_object(raw_text or "")
        if isinstance(parsed, dict) and isinstance(parsed.get("queries"), list):
            queries: list[dict[str, Any]] = []
            for row in parsed["queries"][:4]:
                if not isinstance(row, dict):
                    continue
                q = str(row.get("q") or "").strip()
                if not q:
                    continue
                queries.append(
                    {
                        "q": q[:500],
                        "provider": str(row.get("provider") or "searxng").strip()[:32]
                        or "searxng",
                        "reason": str(row.get("reason") or "llm")[:200],
                    }
                )
            if queries:
                out = {
                    "version": 1,
                    "method": "llm",
                    "queries": queries,
                    "orientation_snapshot": orient_blob if orient_blob else None,
                }
                if search_language:
                    out["search_language"] = search_language
                return out

    queries = _fallback_queries(user_query=user_query, orientation=orientation)
    out = {
        "version": 1,
        "method": "stub_fallback",
        "queries": queries,
        "orientation_snapshot": orientation.model_dump() if orientation else None,
    }
    if search_language:
        out["search_language"] = search_language
    return out


async def execute_search_plan(
    plan: dict[str, Any],
    *,
    limit_per_query: int = 5,
) -> list[dict[str, Any]]:
    """Run each planned query via ``search_multi``; dedupe by URL."""
    from oaao_orchestrator.knowledge.search_providers import search_multi

    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    cap = max(1, min(int(limit_per_query), 10))
    language = str(plan.get("search_language") or "").strip() or None
    for row in plan.get("queries") or []:
        if not isinstance(row, dict):
            continue
        q = str(row.get("q") or "").strip()
        if not q:
            continue
        provider = str(row.get("provider") or "searxng").strip() or "searxng"
        hits = await search_multi(q, limit=cap, provider_ids=[provider], language=language)
        for hit in hits:
            url = str(hit.get("url") or "").strip().lower()
            key = url or str(hit.get("title") or "").lower()
            if key in seen:
                continue
            seen.add(key)
            hit = dict(hit)
            hit["plan_query"] = q
            hit["plan_reason"] = str(row.get("reason") or "")
            merged.append(hit)
    return merged
