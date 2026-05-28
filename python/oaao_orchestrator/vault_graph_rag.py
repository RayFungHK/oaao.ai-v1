"""Vault rail — Qdrant vector search + optional Arango snippets; augments chat messages before LLM."""

from __future__ import annotations
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.vault_rag.embed import (
    _env,
    _openai_embed,
    _resolve_secret,
    ensure_url_scheme,
    openai_compat_embed_batch,
    openai_compat_embeddings_url_from_base,
)
from oaao_orchestrator.vault_rag.types import VaultRagCitation, VaultRagOutcome
from oaao_orchestrator.vault_rag.messages import (
    _inject_system,
    _is_vault_rescan_query,
    _last_user_query,
    _retrieval_query_from_messages,
    inject_system_message,
    is_vault_rescan_query,
    last_user_query,
    retrieval_query_from_messages,
)
from oaao_orchestrator.vault_rag.passages import (
    GROUNDING_RECORD_ZERO_HITS as _GROUNDING_RECORD_ZERO_HITS,
    PassagePick as _PassagePick,
    _append_citation,
    _catalog_entry_map,
    _citation_from_pick,
    _effective_hit_score,
    _embedding_query_for_handbook_lookup,
    _embedding_query_for_record_lookup,
    _format_numbered_passage_block,
    _format_passage_detail_line,
    _handbook_grounding_picks,
    _inject_general_knowledge_only,
    _merge_ranked_hits,
    _min_rag_score,
    _narrow_grounding_picks,
    _passage_relevant_to_query,
    _picks_for_citations,
    _query_is_general_knowledge,
    retrieval_confidence_sufficient,
    _query_wants_meeting_record,
    _query_wants_transcript_evidence,
    _rag_runtime_config,
    _rerank_passage_picks,
    _select_passages_for_vault,
    _source_ref_name_map,
    _vault_rag_grounding_preamble,
    build_slide_grounding_brief,
    grounding_record_zero_hits_text,
    query_wants_meeting_record,
)
from oaao_orchestrator.vault_rag.qdrant import (
    _handbook_passages_via_vault_scroll,
    _qdrant_search,
    _record_passages_via_scope_scroll,
    _scoped_docs_by_vault,
)

logger = logging.getLogger(__name__)

async def _arango_bonus_lines(
    profile: dict[str, Any],
    query: str,
    doc_ids: list[int],
    *,
    graph_limit: int = 12,
) -> list[str]:
    """Graph context lines for chat — entity/relation search in Arango (built-in AQL or OAAO_ARANGO_RAG_AQL)."""
    if not query.strip():
        return []
    async with httpx.AsyncClient() as client:
        from oaao_orchestrator.vault_arango import query_graph_context_lines

        return await query_graph_context_lines(
            client,
            profile,
            query=query,
            document_ids=doc_ids,
            limit=max(4, min(16, int(graph_limit))),
        )


async def augment_chat_messages_for_vault_rag(
    messages: list[dict[str, Any]],
    vault_retrieval_profiles: list[dict[str, Any]] | None,
    *,
    embedding: dict[str, Any] | None = None,
    rerank: dict[str, Any] | None = None,
    vault_source_refs: list[dict[str, Any]] | None = None,
    vault_scope_documents: dict[int, list[int]] | None = None,
    vault_auto_rag: bool = False,
    vault_document_catalog: dict[str, Any] | None = None,
    vault_rag: dict[str, Any] | None = None,
) -> VaultRagOutcome:
    """
    Mutates ``messages`` in place: prepends grounding system instructions.

    Vault excerpts **supplement** the reply when on-topic; otherwise the model answers from general knowledge.
    """

    out = VaultRagOutcome(passage_count=0, profile_hits=0)
    profiles = [p for p in (vault_retrieval_profiles or []) if isinstance(p, dict)]
    if not profiles:
        from oaao_orchestrator.slide_project.teaching_intent import (
            text_signals_personal_record_lookup,
            text_signals_vault_grounding,
        )

        query = _last_user_query(messages)
        handbook_turn = bool(query and text_signals_vault_grounding(query))
        record_turn = bool(query and text_signals_personal_record_lookup(query))
        if vault_auto_rag or handbook_turn or record_turn:
            if handbook_turn:
                _inject_system(
                    messages,
                    "Knowledge-base search was requested for a **handbook / volume** question, but no embedded "
                    "documents are available in the current workspace scope (or retrieval profiles could not be loaded). "
                    "Tell the user no handbook excerpts were retrieved and they should confirm the Regulatory Handbook "
                    "(or relevant Vol.) file is embedded in Vault for this workspace.",
                )
            else:
                _inject_system(
                    messages,
                    "Knowledge-base search was requested for this turn, but no embedded documents "
                    "are available in the current workspace scope (or retrieval profiles could not be loaded). "
                    "Answer from general knowledge when needed. Do **not** claim you cannot access the user's "
                    "private vault or knowledge base — the search step ran with an empty scope.",
                )
            out.activity_lines = ["vault_rag · no_profiles · scope_empty"]
        return out

    # Manual composer picks — not workspace-wide Auto Source expansion.
    manual_scope = bool(vault_source_refs) or bool(vault_scope_documents)
    explicit_scope = manual_scope and not vault_auto_rag

    last_query = _last_user_query(messages)
    if not last_query:
        return out

    query = _retrieval_query_from_messages(messages)
    vault_rescan = _is_vault_rescan_query(last_query)

    from oaao_orchestrator.slide_project.teaching_intent import (
        text_signals_vault_grounding,
    )

    handbook_turn = bool(text_signals_vault_grounding(query))
    wants_record = _query_wants_meeting_record(query)
    wants_gk = _query_is_general_knowledge(query) and not handbook_turn

    emb_cfg = embedding if isinstance(embedding, dict) else {}
    bu = str(emb_cfg.get("base_url") or "").strip()
    mo = str(emb_cfg.get("model") or "").strip()
    url_direct = str(emb_cfg.get("url") or "").strip()
    if not mo:
        _inject_system(
            messages,
            "Vault retrieval is disabled: the embedding Purpose has no **model** on its default endpoint.",
        )
        out.activity_lines = ["vault_rag · embedding_model_missing — general knowledge fallback"]
        return out
    if not url_direct and not bu:
        _inject_system(
            messages,
            "Vault retrieval is disabled: PostgreSQL Purpose allocation has no enabled embedding endpoint "
            "(assign default endpoint under embedding.primary / embedding.* in administrator settings).",
        )
        out.activity_lines = ["vault_rag · embedding_purpose_missing — general knowledge fallback"]
        return out

    ek: str | None = None
    ake = emb_cfg.get("api_key_env")
    if isinstance(ake, str) and ake.strip():
        ek = _resolve_secret(ake.strip())

    embed_url = (
        ensure_url_scheme(url_direct) if url_direct else openai_compat_embeddings_url_from_base(bu)
    )
    if wants_record:
        embed_query = _embedding_query_for_record_lookup(query)
    elif handbook_turn:
        embed_query = _embedding_query_for_handbook_lookup(query)
    else:
        embed_query = query

    scope_by_vault = _scoped_docs_by_vault(vault_source_refs, vault_scope_documents)
    passages: list[str] = []
    all_picks: list[_PassagePick] = []
    seen: set[str] = set()
    doc_ids_hit: set[int] = set()
    citation_refs: list[VaultRagCitation] = []
    ref_names = _source_ref_name_map(vault_source_refs)
    catalog_entries = _catalog_entry_map(vault_document_catalog)
    default_qdrant = _env("OAAO_QDRANT_URL", "http://qdrant:6333").rstrip("/")
    rag_cfg = _rag_runtime_config(vault_rag)
    per_vault_limit = int(rag_cfg["qdrant_limit"])
    min_score = float(rag_cfg["min_score"])
    if wants_record:
        min_score = max(0.12, min_score * 0.45)
    elif handbook_turn:
        min_score = max(0.10, min_score * 0.55)
    handbook_pick_limit = max(16, per_vault_limit * 3) if handbook_turn else per_vault_limit
    graph_limit = int(rag_cfg["graph_limit"])
    fetch_limit = max(handbook_pick_limit, min(32, handbook_pick_limit * 2))
    below_score = 0
    gk_had_off_topic = False
    used_scope_scroll = False

    vector, emb_err = await _openai_embed(embed_query, ek, url=embed_url, model=mo)
    if not vector and wants_record and scope_by_vault:
        all_picks = await _record_passages_via_scope_scroll(
            profiles,
            scope_by_vault,
            per_vault_limit=per_vault_limit,
            min_score=min_score,
            seen=seen,
            default_qdrant=default_qdrant,
        )
        if all_picks:
            used_scope_scroll = True
            out.profile_hits = len({p.vault_id for p in all_picks if p.vault_id > 0}) or 1

    if not vector and not used_scope_scroll:
        if wants_record:
            _inject_system(messages, _GROUNDING_RECORD_ZERO_HITS)
        else:
            _inject_system(
                messages,
                "Vault retrieval could not compute an embedding for this question. "
                "Answer helpfully from general knowledge without blaming missing documents or retrieval failures.",
            )
        hint = emb_err or "unknown"
        out.activity_lines = [f"vault_rag · embedding_failed ({hint}) — general knowledge fallback"]
        return out

    if vector:
        for profile in profiles:
            vid = int(profile.get("vault_id") or 0)
            if vid < 1:
                continue
            qurl = (profile.get("qdrant_url") or "").strip() or default_qdrant
            qcol = (profile.get("qdrant_collection") or "").strip()
            if not qcol:
                continue
            qkey_env = profile.get("qdrant_api_key_env")
            qkey = _resolve_secret(qkey_env) if qkey_env else None
            scope_docs = None
            if vault_scope_documents and vid in vault_scope_documents:
                scope_docs = vault_scope_documents.get(vid)
            raw_hits = await _qdrant_search(
                base_url=qurl,
                collection=qcol,
                vector=vector,
                vault_id=vid,
                api_key=qkey,
                limit=max(2, min(24, fetch_limit)),
                document_ids=scope_docs,
            )
            summary_hits = await _qdrant_search(
                base_url=qurl,
                collection=qcol,
                vector=vector,
                vault_id=vid,
                api_key=qkey,
                limit=max(2, min(8, per_vault_limit + 2)),
                document_ids=scope_docs,
                segment_scope="transcript_summary",
            )
            if raw_hits or summary_hits:
                out.profile_hits += 1
            general_ranked: list[tuple[float, dict[str, Any]]] = []
            for h in raw_hits:
                if not isinstance(h, dict):
                    continue
                eff = _effective_hit_score(h, rag_cfg)
                if eff is None:
                    continue
                general_ranked.append((eff, h))
            summary_ranked: list[tuple[float, dict[str, Any]]] = []
            for h in summary_hits:
                if not isinstance(h, dict):
                    continue
                eff = _effective_hit_score(h, rag_cfg)
                if eff is None:
                    continue
                summary_ranked.append((eff + 0.08, h))
            ranked = _merge_ranked_hits(summary_ranked, general_ranked)
            vault_picks, vault_below = _select_passages_for_vault(
                ranked,
                vault_id=vid,
                per_vault_limit=handbook_pick_limit if handbook_turn else per_vault_limit,
                min_score=min_score,
                seen=seen,
                query_wants_record=wants_record,
            )
            below_score += vault_below
            for pick in vault_picks:
                all_picks.append(pick)

    if not all_picks and scope_by_vault and (wants_record or handbook_turn or vault_rescan):
        scroll_picks = await _record_passages_via_scope_scroll(
            profiles,
            scope_by_vault,
            per_vault_limit=max(8, per_vault_limit) if vault_rescan else per_vault_limit,
            min_score=max(0.06, min_score * 0.35) if vault_rescan else min_score,
            seen=seen,
            default_qdrant=default_qdrant,
        )
        if scroll_picks:
            all_picks = scroll_picks
            used_scope_scroll = True
            out.profile_hits = max(
                out.profile_hits, len({p.vault_id for p in all_picks if p.vault_id > 0}) or 1
            )

    if not all_picks and handbook_turn:
        vault_scroll = await _handbook_passages_via_vault_scroll(
            profiles,
            per_vault_limit=per_vault_limit,
            min_score=min_score,
            seen=seen,
            default_qdrant=default_qdrant,
        )
        if vault_scroll:
            all_picks = vault_scroll
            used_scope_scroll = True
            out.profile_hits = max(
                out.profile_hits, len({p.vault_id for p in all_picks if p.vault_id > 0}) or 1
            )

    rerank_cfg = rerank if isinstance(rerank, dict) else None
    if all_picks and rerank_cfg:
        rerank_top = int(rag_cfg.get("rerank_limit") or 12)
        all_picks = await _rerank_passage_picks(query, all_picks, rerank_cfg, top_n=rerank_top)

    if all_picks:
        if handbook_turn:
            all_picks = _handbook_grounding_picks(query, all_picks, limit=handbook_pick_limit)
        elif vault_rescan:
            all_picks = all_picks[:12]
        else:
            relevant = [p for p in all_picks if _passage_relevant_to_query(query, p.passage)]
            if relevant:
                all_picks = relevant
            elif wants_record:
                summaries = [p for p in all_picks if p.segment_type == "transcript_summary"]
                if summaries:
                    all_picks = summaries
                elif all_picks:
                    all_picks = sorted(all_picks, key=lambda p: len(p.passage), reverse=True)[:4]
            elif wants_gk:
                gk_had_off_topic = True
                all_picks = []
            else:
                gk_had_off_topic = True
                all_picks = []

    auto_source = vault_auto_rag and not manual_scope
    if all_picks and not handbook_turn and not wants_record and not explicit_scope and not vault_rescan:
        if auto_source:
            if not retrieval_confidence_sufficient(all_picks, min_score=min_score):
                gk_had_off_topic = True
                all_picks = []
            else:
                all_picks = sorted(
                    all_picks,
                    key=lambda p: float(p.score or 0.0),
                    reverse=True,
                )[: max(6, per_vault_limit)]
        else:
            strict_relevant = [
                p for p in all_picks if _passage_relevant_to_query(query, p.passage, strict=True)
            ]
            if not strict_relevant:
                gk_had_off_topic = True
                all_picks = []
            else:
                all_picks = strict_relevant

    all_picks = _narrow_grounding_picks(query, all_picks)

    has_transcript_summary = any(p.segment_type == "transcript_summary" for p in all_picks)
    cite_pool = (
        [p for p in all_picks if not _handbook_chunk_is_toc_or_cover(_handbook_pick_body_text(p))]
        if handbook_turn
        else all_picks
    )
    citation_picks = _picks_for_citations(query, cite_pool or all_picks, wants_gk=wants_gk)

    if handbook_turn or wants_record or explicit_scope or vault_rescan:
        grounding_picks = all_picks[:32]
    elif auto_source:
        grounding_picks = all_picks[:32]
    else:
        grounding_picks = citation_picks[:32]

    passages = []
    for pick in grounding_picks:
        if pick.document_id > 0:
            doc_ids_hit.add(pick.document_id)

    numbered_citation_refs: list[VaultRagCitation] = []
    for idx, pick in enumerate(grounding_picks, start=1):
        body = pick.passage.split("\n", 1)[-1].strip() if pick.passage else ""
        passages.append(_format_numbered_passage_block(idx, pick, body))
        numbered = _citation_from_pick(
            cite_index=idx,
            pick=pick,
            ref_names=ref_names,
            catalog_entries=catalog_entries,
        )
        if numbered is not None:
            numbered_citation_refs.append(numbered)

    citation_refs = numbered_citation_refs

    graph_lines: list[str] = []
    for profile in profiles:
        if int(profile.get("graph_mode") or 0) < 1:
            continue
        extra = await _arango_bonus_lines(
            profile, query, sorted(doc_ids_hit), graph_limit=graph_limit
        )
        graph_lines.extend(extra)

    # Graph-only hit path: vector search missed but graph entities match the question.
    if not passages and not graph_lines:
        for profile in profiles:
            if int(profile.get("graph_mode") or 0) < 1:
                continue
            extra = await _arango_bonus_lines(profile, query, [], graph_limit=graph_limit)
            graph_lines.extend(extra)

    if wants_gk and not passages:
        graph_lines = []

    block = "\n\n---\n\n".join(passages[:32])
    if graph_lines:
        block += "\n\n--- Graph context ---\n" + "\n".join(f"• {g}" for g in graph_lines[:16])

    if passages or graph_lines:
        out.passage_count = len(passages) + len(graph_lines)
        out.slide_grounding_brief = build_slide_grounding_brief(
            all_picks,
            graph_lines=graph_lines,
        )
        _inject_system(
            messages,
            _vault_rag_grounding_preamble(
                has_transcript_summary=has_transcript_summary,
                wants_record=wants_record,
                inline_citations=bool(numbered_citation_refs),
                handbook_turn=handbook_turn,
            )
            + "\n\n--- Vault excerpts (use for your answer) ---\n\n"
            + block,
        )
        out.detail_lines = [
            _format_passage_detail_line(p) for p in (citation_picks or all_picks)[:8]
        ]
        if graph_lines and len(out.detail_lines) < 8:
            for g in graph_lines[: max(0, 8 - len(out.detail_lines))]:
                flat = re.sub(r"\s+", " ", str(g)).strip()
                out.detail_lines.append(
                    ("Graph · " + flat)[:96] + ("…" if len(flat) > 88 else ""),
                )
        out.citation_refs = sorted(
            citation_refs,
            key=lambda c: (
                c.cite_index if c.cite_index is not None else 9999,
                c.vault_id,
                c.file_name.lower() or f"doc-{c.document_id}",
                c.document_id,
                c.begin_ms if c.begin_ms is not None else -1,
                c.chunk_index if c.chunk_index is not None else -1,
            ),
        )
        suffix = f" min_score={min_score}" if below_score else ""
        mode = " scope_scroll_fallback" if used_scope_scroll else ""
        out.activity_lines = [
            f"vault_rag · passages={len(passages)} graph_lines={len(graph_lines)} profiles={out.profile_hits}{mode}{suffix}",
        ]
        return out

    if wants_record:
        _inject_system(messages, _GROUNDING_RECORD_ZERO_HITS)
    elif handbook_turn:
        _inject_system(
            messages,
            "The user asked about a **specific handbook volume** in the workspace knowledge base "
            "(e.g. Regulatory Handbook Vol.3). Vault search returned **no matching excerpts** for this turn. "
            "State clearly that no on-topic Vol./volume passage was retrieved from embedded vault documents. "
            "Do **not** answer as if the user referred to an unknown industry-wide handbook in the abstract. "
            "Suggest checking that the handbook file is embedded in Vault and named with handbook/volume markers. "
            "You may add brief general context only if clearly labeled as outside retrieved sources.",
        )
    else:
        _inject_general_knowledge_only(messages, explicit_scope=explicit_scope)
    if gk_had_off_topic:
        out.activity_lines = [
            "vault_rag · gk_off_topic — vault hits unrelated, general knowledge answer",
        ]
        return out

    if explicit_scope:
        out.activity_lines = [
            "vault_rag · zero_hits · manual_scope — brief note, then general knowledge answer",
        ]
        return out

    if below_score:
        out.activity_lines = [
            f"vault_rag · zero_hits (filtered {below_score} below min_score={min_score}) — general knowledge",
        ]
    else:
        out.activity_lines = ["vault_rag · zero_hits — general knowledge answer"]
    return out


def build_pipeline_snapshot_for_rag(
    outcome: VaultRagOutcome, base: dict[str, Any]
) -> dict[str, Any]:
    """Merge retrieval outcome into pipeline UI — vault step only (no stub artifacts)."""

    snap = dict(base)
    lines = list((snap.get("activity") or {}).get("lines") or [])
    for ln in outcome.activity_lines:
        lines.insert(0, ln)
    snap["activity"] = {"lines": lines[:24]}

    if outcome.passage_count > 0:  # noqa: SIM108
        rail_badge = f"{outcome.passage_count} passages"
    else:
        rail_badge = "No matches"
    rail_detail = outcome.detail_lines[:8] if outcome.detail_lines else []

    snap["milestone"] = {
        "steps": [
            {
                "title": "Vault retrieval",
                "description": "Vector + graph over scoped sources",
                "state": "completed",
                "rail": {
                    "badge": rail_badge,
                    "detail_lines": rail_detail,
                },
            },
        ],
    }
    blocks: list[dict[str, Any]] = []
    for raw in snap.get("blocks") or []:
        if isinstance(raw, dict) and raw.get("type") != "rag_citations":
            blocks.append(raw)
    if outcome.citation_refs:
        blocks.append(
            {
                "type": "rag_citations",
                "zone": "after",
                "title": "References",
                "props": {
                    "inline": True,
                    "references": [
                        {
                            "cite_index": c.cite_index,
                            "vault_id": c.vault_id,
                            "document_id": c.document_id,
                            "file_name": c.file_name,
                            "vault_name": c.vault_name,
                            "path": c.path,
                            "segment_types": list(c.segment_types),
                            "chunk_index": c.chunk_index,
                            "segment_index": c.segment_index,
                            "begin_ms": c.begin_ms,
                            "end_ms": c.end_ms,
                            "speaker_id": c.speaker_id,
                            "speaker_label": c.speaker_label,
                            "excerpt": c.excerpt,
                        }
                        for c in outcome.citation_refs
                    ],
                },
            },
        )
    snap["blocks"] = blocks
    snap["artifacts"] = []
    passages_for_accs = [
        {
            "file_name": c.file_name,
            "excerpt": (c.excerpt or "")[:800],
        }
        for c in outcome.citation_refs[:8]
        if (c.excerpt or "").strip()
    ]
    snap["vault_rag"] = {
        "passage_count": outcome.passage_count,
        "profile_hits": outcome.profile_hits,
        "passages": passages_for_accs,
    }
    return snap
