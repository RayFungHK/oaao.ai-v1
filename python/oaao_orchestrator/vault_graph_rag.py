"""Vault rail — Qdrant vector search + optional Arango snippets; augments chat messages before LLM."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from oaao_orchestrator.vault_rag.embed import (
    _env,
    _openai_embed,
    ensure_url_scheme,
    openai_compat_embed_batch,
    openai_compat_embeddings_url_from_base,
)
from oaao_orchestrator.vault_rag.qdrant import (
    _qdrant_must_filter,
    _qdrant_scroll,
    _qdrant_search,
    _scroll_points_to_hits,
)
from oaao_orchestrator.vault_rag.types import VaultRagCitation, VaultRagOutcome

logger = logging.getLogger(__name__)


def _last_user_query(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "user":
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            return c.strip()
    return ""


def _prior_user_queries(messages: list[dict[str, Any]], *, skip_last: bool = True) -> list[str]:
    """Earlier user turns (newest first), optionally skipping the latest user message."""
    out: list[str] = []
    skipped = not skip_last
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "user":
            continue
        c = m.get("content")
        if not isinstance(c, str) or not c.strip():
            continue
        if not skipped:
            skipped = True
            continue
        out.append(c.strip())
    return out


def _is_vault_rescan_query(query: str) -> bool:
    """True when the user asks to re-search vault without restating the topic (e.g. 再查一下 Vault)."""
    q = query.strip()
    if not q:
        return False
    low = q.lower()
    has_vault = (
        "vault" in low
        or "知識庫" in q
        or "知识库" in q
        or "知識库" in q
    )
    if not has_vault:
        return False
    rescan = any(
        token in low or token in q
        for token in (
            "再查",
            "重新查",
            "再搜",
            "重新搜",
            "再找找",
            "again",
            "recheck",
            "re-check",
        )
    )
    lookup = any(token in low or token in q for token in ("查", "搜", "找", "search", "check", "look"))
    short = len(q) <= 64
    return short and (rescan or lookup)


def _retrieval_query_from_messages(messages: list[dict[str, Any]]) -> str:
    """Embedding / relevance query — reuse prior user turn on vault re-scan follow-ups."""
    last = _last_user_query(messages)
    if not last:
        return ""
    if not _is_vault_rescan_query(last):
        return last
    for prior in _prior_user_queries(messages):
        if not _is_vault_rescan_query(prior):
            return prior
    return last


def _inject_system(messages: list[dict[str, Any]], content: str) -> None:
    if messages and str(messages[0].get("role") or "").lower() == "system":
        prev = messages[0].get("content")
        messages[0]["content"] = (
            f"{content}\n\n{prev}" if isinstance(prev, str) and prev.strip() else content
        )
    else:
        messages.insert(0, {"role": "system", "content": content})


def last_user_query(messages: list[dict[str, Any]]) -> str:
    """Public API — last user message text (HR-1)."""
    return _last_user_query(messages)


def retrieval_query_from_messages(messages: list[dict[str, Any]]) -> str:
    """Public API — query text for vault vector search (may reuse prior turn on re-scan)."""
    return _retrieval_query_from_messages(messages)


def is_vault_rescan_query(query: str) -> bool:
    """Public API — whether the user asked to re-search vault without restating the topic."""
    return _is_vault_rescan_query(query)


def inject_system_message(messages: list[dict[str, Any]], content: str) -> None:
    """Public API — prepend/merge system grounding block."""
    _inject_system(messages, content)


def query_wants_meeting_record(query: str) -> bool:
    """Public API — whether query targets meeting / transcript records."""
    return _query_wants_meeting_record(query)


def grounding_record_zero_hits_text() -> str:
    """Public API — system prompt when record search returned zero hits."""
    return _GROUNDING_RECORD_ZERO_HITS




def _hit_score(hit: dict[str, Any]) -> float | None:
    raw = hit.get("score")
    if isinstance(raw, (int, float)):
        return float(raw)

    return None


def _min_rag_score(cfg: dict[str, Any] | None = None) -> float:
    if isinstance(cfg, dict):
        raw = cfg.get("min_score")
        if raw is not None and raw != "":
            try:
                return max(0.0, min(1.0, float(raw)))
            except (TypeError, ValueError):
                pass
    raw = _env("OAAO_VAULT_RAG_MIN_SCORE", "0.38")
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return 0.38


def _rag_runtime_config(vault_rag: dict[str, Any] | None) -> dict[str, float | int]:
    """Settings → RAG (PHP {@code vault_rag} payload) with env fallbacks."""
    src = vault_rag if isinstance(vault_rag, dict) else {}

    def _int(key: str, env_name: str, default: int, lo: int, hi: int) -> int:
        raw = src.get(key)
        if raw is None or raw == "":
            raw = _env(env_name, str(default))
        try:
            n = int(round(float(raw)))  # noqa: RUF046
        except (TypeError, ValueError):
            n = default
        return max(lo, min(hi, n))

    def _float(key: str, env_name: str, default: float, lo: float, hi: float) -> float:
        raw = src.get(key)
        if raw is None or raw == "":
            raw = _env(env_name, str(default))
        try:
            f = float(raw)
        except (TypeError, ValueError):
            f = default
        return max(lo, min(hi, round(f, 4)))

    return {
        "qdrant_limit": _int("qdrant_limit", "OAAO_VAULT_RAG_QDRANT_LIMIT", 6, 2, 24),
        "min_score": _float("min_score", "OAAO_VAULT_RAG_MIN_SCORE", 0.38, 0.0, 1.0),
        "graph_limit": _int("graph_limit", "OAAO_VAULT_RAG_GRAPH_LIMIT", 12, 4, 16),
        "transcript_summary_boost": _float("transcript_summary_boost", "", 0.10, 0.0, 0.3),
        "asr_transcript_boost": _float("asr_transcript_boost", "", 0.03, 0.0, 0.2),
        "rerank_limit": _int("rerank_limit", "OAAO_VAULT_RAG_RERANK_LIMIT", 12, 4, 32),
    }


def _segment_type_from_payload(pl: dict[str, Any]) -> str | None:
    scope = str(pl.get("segment_scope") or "").strip().lower()
    if scope == "transcript_summary":
        return "transcript_summary"
    if scope == "plain":
        fa = pl.get("from_asr")
        if fa is True or fa == 1 or str(fa).lower() in ("1", "true", "yes"):
            return "asr_transcript"
    return None


def _score_boost_for_payload(pl: dict[str, Any], cfg: dict[str, float | int]) -> float:
    st = _segment_type_from_payload(pl)
    if st == "transcript_summary":
        return float(cfg.get("transcript_summary_boost") or 0.0)
    if st == "asr_transcript":
        return float(cfg.get("asr_transcript_boost") or 0.0)
    return 0.0


def _effective_hit_score(hit: dict[str, Any], cfg: dict[str, float | int]) -> float | None:
    raw = _hit_score(hit)
    if raw is None:
        return None
    pl = hit.get("payload")
    if not isinstance(pl, dict):
        return raw
    return raw + _score_boost_for_payload(pl, cfg)


def _passage_type_label(segment_type: str | None) -> str:
    if segment_type == "transcript_summary":
        return "Transcript summary"
    if segment_type == "asr_transcript":
        return "ASR transcript"
    return ""


def _passage_fingerprint(
    vid: int, did: int | None, txt: str, *, begin_ms: int | None = None
) -> str:
    if begin_ms is not None and begin_ms >= 0:
        return f"{vid}:{did}:{begin_ms}:{txt[:80]}"
    return f"{vid}:{did}:{txt[:80]}"


def _format_passage_block(vid: int, did: int | None, seg_type: str | None, txt: str) -> str:
    type_label = _passage_type_label(seg_type)
    label = f"[vault {vid}" + (f", doc {did}" if did is not None else "")
    if type_label:
        label += f" · {type_label}"
    label += "]"
    return f"{label}\n{txt}"


def _format_numbered_passage_block(cite_index: int, pick: _PassagePick, body: str) -> str:
    """Numbered excerpt for LLM grounding — index aligns with inline [n] markers."""
    fn = (pick.file_name or "").strip() or f"document {pick.document_id}"
    type_label = _passage_type_label(pick.segment_type)
    header = f"[{cite_index}] {fn}"
    if type_label:
        header += f" · {type_label}"
    if pick.speaker_label:
        header += f" · {pick.speaker_label}"
    if pick.begin_ms is not None and pick.begin_ms >= 0:
        total_sec = max(0, int(pick.begin_ms // 1000))
        m, s = divmod(total_sec, 60)
        h, m = divmod(m, 60)
        ts = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        header += f" @ {ts}"
    text = (body or pick.excerpt or "").strip()
    return f"{header}\n{text}" if text else header


def _citation_from_pick(
    *,
    cite_index: int,
    pick: _PassagePick,
    ref_names: dict[tuple[int, int], str],
    catalog_entries: dict[tuple[int, int], dict[str, str]],
) -> VaultRagCitation | None:
    if pick.document_id < 1:
        return None
    key = (pick.vault_id, pick.document_id)
    cat = catalog_entries.get(key) or {}
    resolved = (pick.file_name or ref_names.get(key) or cat.get("file_name") or "").strip()
    seg_types = [pick.segment_type] if pick.segment_type else []
    body = pick.passage.split("\n", 1)[-1].strip() if pick.passage else ""
    excerpt = (pick.excerpt or body or "")[:360]
    return VaultRagCitation(
        vault_id=pick.vault_id,
        document_id=pick.document_id,
        file_name=resolved,
        vault_name=str(cat.get("vault_name") or "").strip(),
        path=str(cat.get("path") or "").strip(),
        segment_types=seg_types,
        chunk_index=pick.chunk_index,
        segment_index=pick.segment_index,
        begin_ms=pick.begin_ms,
        end_ms=pick.end_ms,
        speaker_id=pick.speaker_id,
        speaker_label=pick.speaker_label,
        excerpt=excerpt,
        cite_index=cite_index,
    )


@dataclass
class _PassagePick:
    passage: str
    vault_id: int
    document_id: int
    file_name: str
    segment_type: str | None
    chunk_index: int | None = None
    segment_index: int | None = None
    begin_ms: int | None = None
    end_ms: int | None = None
    speaker_id: int | None = None
    speaker_label: str = ""
    excerpt: str = ""


async def _rerank_passage_picks(
    query: str,
    picks: list[_PassagePick],
    rerank_cfg: dict[str, Any] | None,
    *,
    top_n: int,
) -> list[_PassagePick]:
    if not picks or not isinstance(rerank_cfg, dict):
        return picks
    from oaao_orchestrator.vault_rerank import rerank_passages

    texts: list[str] = []
    for pick in picks:
        body = pick.passage.split("\n", 1)[-1].strip() if pick.passage else ""
        texts.append(body or pick.passage)
    ranked = await rerank_passages(query, texts, rerank_cfg, top_n=min(top_n, len(texts)))
    if not ranked:
        return picks
    order: list[int] = []
    for idx, _score in ranked:
        if 0 <= idx < len(picks) and idx not in order:
            order.append(idx)
    for i in range(len(picks)):
        if i not in order:
            order.append(i)
    return [picks[i] for i in order]


def build_slide_grounding_brief(
    picks: list[_PassagePick],
    *,
    graph_lines: list[str] | None = None,
    max_passages: int = 24,
    max_chars: int = 14_000,
) -> str:
    """
    Group vault hits by source file for slide outline / per-page coding (step C after RAG).
    """
    if not picks and not graph_lines:
        return ""
    by_doc: dict[tuple[int, int], list[_PassagePick]] = {}
    order: list[tuple[int, int]] = []
    for pick in picks:
        key = (pick.vault_id, pick.document_id)
        if key not in by_doc:
            by_doc[key] = []
            order.append(key)
        if len(by_doc[key]) < max(3, max_passages // max(1, len(order))):
            by_doc[key].append(pick)
    sections: list[str] = []
    for vid, did in order:
        group = by_doc.get((vid, did)) or []
        if not group:
            continue
        head = (group[0].file_name or "").strip() or f"document_{did}"
        lines = [f"## {head} (vault {vid}, doc {did})", ""]
        for i, pick in enumerate(group, start=1):
            body = pick.passage.split("\n", 1)[-1].strip()
            body = re.sub(r"\n{3,}", "\n\n", body)
            label = _passage_type_label(pick.segment_type)
            cap = f"### Excerpt {i}" + (f" · {label}" if label else "")
            lines.append(cap)
            lines.append(body)
            lines.append("")
        sections.append("\n".join(lines).strip())
    if graph_lines:
        gl = "\n".join(
            "- " + re.sub(r"\s+", " ", str(g)).strip() for g in graph_lines[:12] if str(g).strip()
        )
        if gl:
            sections.append("## Graph context\n\n" + gl)
    brief = "\n\n".join(sections).strip()
    return brief[:max_chars] if brief else ""


def _format_passage_detail_line(pick: _PassagePick) -> str:
    """One-line summary for pipeline UI — not full passage bodies."""
    type_label = _passage_type_label(pick.segment_type)
    body = pick.passage.split("\n", 1)[-1]
    body = re.sub(r"\s+", " ", body).strip()
    parts = [f"doc {pick.document_id}"]
    if type_label:
        parts.append(type_label)
    name = (pick.file_name or "").strip()
    if name:
        parts.append(name)
    if pick.speaker_label:
        parts.append(pick.speaker_label)
    if pick.begin_ms is not None and pick.begin_ms >= 0:
        total_sec = pick.begin_ms // 1000
        h = total_sec // 3600
        m = (total_sec % 3600) // 60
        s = total_sec % 60
        stamp = f"{h}:{m:02d}:{s:02d}" if h > 0 else f"{m}:{s:02d}"
        parts.append(stamp)
    prefix = " · ".join(parts)
    if not body:
        return prefix[:96]
    line = f"{prefix} — {body}"
    return line[:96] + ("…" if len(line) > 96 else "")


def _select_passages_for_vault(
    ranked: list[tuple[float, dict[str, Any]]],
    *,
    vault_id: int,
    per_vault_limit: int,
    min_score: float,
    seen: set[str],
    query_wants_record: bool = False,
) -> tuple[list[_PassagePick], int]:
    """
    Prefer transcript_summary for audio docs; cap raw ASR plain when a summary exists for the same document.

    Long recordings often embed unrelated small-talk ASR chunks that outrank the curated summary on some queries.
    """
    below_score = 0
    summary_floor = max(0.0, min_score * (0.65 if query_wants_record else 0.85))
    max_summary_slots = max(1, min(3 if query_wants_record else 2, per_vault_limit))

    best_summary_by_doc: dict[int, tuple[float, dict[str, Any]]] = {}
    for eff, hit in ranked:
        pl = hit.get("payload")
        if not isinstance(pl, dict):
            continue
        if _segment_type_from_payload(pl) != "transcript_summary":
            continue
        if eff < summary_floor:
            continue
        txt, did, _ = _passage_from_hit(hit)
        if not txt or not isinstance(did, int) or did < 1:
            continue
        prev = best_summary_by_doc.get(did)
        if prev is None or eff > prev[0]:
            best_summary_by_doc[did] = (eff, hit)

    picks: list[_PassagePick] = []
    docs_with_summary: set[int] = set()
    for did, (_eff, hit) in sorted(  # noqa: B007
        best_summary_by_doc.items(), key=lambda row: row[1][0], reverse=True
    )[:max_summary_slots]:
        pick = _passage_pick_from_hit(hit, vault_id=vault_id)
        if pick is None or pick.document_id < 1:
            continue
        fp = _passage_fingerprint(vault_id, pick.document_id, pick.passage, begin_ms=pick.begin_ms)
        if fp in seen:
            continue
        seen.add(fp)
        docs_with_summary.add(pick.document_id)
        pick.segment_type = "transcript_summary"
        picks.append(pick)

    plain_asr_per_doc: dict[int, int] = {}
    for eff, hit in ranked:
        if len(picks) >= per_vault_limit:
            break
        if eff < min_score:
            below_score += 1
            continue
        pick = _passage_pick_from_hit(hit, vault_id=vault_id)
        if pick is None or pick.document_id < 1:
            continue
        seg_type = pick.segment_type
        if seg_type == "transcript_summary":
            continue
        doc_id = pick.document_id
        fp = _passage_fingerprint(vault_id, doc_id, pick.passage, begin_ms=pick.begin_ms)
        if fp in seen:
            continue
        if doc_id in docs_with_summary and seg_type == "asr_transcript":
            if query_wants_record:
                continue
            if plain_asr_per_doc.get(doc_id, 0) >= 1:
                continue
            plain_asr_per_doc[doc_id] = plain_asr_per_doc.get(doc_id, 0) + 1
        seen.add(fp)
        picks.append(pick)

    return picks, below_score


def _query_wants_meeting_record(query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return False
    markers = (
        "记录",
        "記錄",
        "之前",
        "有没有",
        "有沒有",
        "用法",
        "钱包",
        "錢包",
        "會議",
        "会议",
        "摘要",
        "meeting",
        "minutes",
        "transcript summary",
    )
    return any(m in q for m in markers)


def _query_wants_transcript_evidence(query: str) -> bool:
    """Meeting / audio / wallet follow-ups — cite transcript summary, not stray PDF chunks."""
    if _query_wants_meeting_record(query):
        return True
    q = query.strip()
    if not q:
        return False
    markers = (
        "說過",
        "说过",
        "什麼時候",
        "什么时候",
        "何時",
        "何时",
        "理監事",
        "理事长",
        "董事",
        "監事",
        "监事",
        "安裝",
        "安装",
        "轉寫",
        "转写",
        "教學",
        "教学",
        "示範",
        "示范",
        "窩輪",
        "窝轮",
    )
    return any(m in q for m in markers)


_QUERY_TERM_STOP = frozenset(
    {
        "什么",
        "什麼",
        "是",
        "吗",
        "嗎",
        "的",
        "了",
        "请",
        "請",
        "问",
        "問",
        "what",
        "is",
        "the",
        "a",
        "an",
        "how",
        "does",
        "do",
        "why",
        "define",
        "explain",
    },
)


def _query_is_general_knowledge(query: str) -> bool:
    """Definition / concept questions — answer from LLM knowledge unless vault text clearly matches."""
    if _query_wants_meeting_record(query):
        return False
    q = query.strip().lower()
    if not q:
        return False
    starters = (
        "什么是",
        "什麼是",
        "何谓",
        "何謂",
        "what is",
        "what's",
        "whats ",
        "define ",
        "explain ",
        "解釋",
        "解释",
        "請解釋",
        "请解释",
        "介绍一下",
        "介紹一下",
        "請介紹",
        "请介绍",
    )
    if any(s in q for s in starters):
        return True
    latin_terms = (
        "fourier",
        "transform",
        "algorithm",
        "theorem",
        "calculus",
        "matrix",
        "python",
        "javascript",
        "api",
    )
    return any(t in q for t in latin_terms)


def _query_terms(query: str) -> list[str]:
    q = query.strip().lower()
    for prefix in (
        "什么是",
        "什麼是",
        "何谓",
        "何謂",
        "请解释",
        "請解釋",
        "介绍一下",
        "介紹一下",
        "请介绍",
        "請介紹",
    ):
        q = q.replace(prefix, "")
    terms: list[str] = []
    for chunk in re.findall(r"[\w\u4e00-\u9fff]+", q):
        if len(chunk) < 2 or chunk in _QUERY_TERM_STOP:
            continue
        terms.append(chunk)
        if re.fullmatch(r"[\u4e00-\u9fff]+", chunk) and len(chunk) >= 4:
            for i in range(len(chunk) - 1):
                bigram = chunk[i : i + 2]
                if bigram not in _QUERY_TERM_STOP:
                    terms.append(bigram)
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _passage_relevant_to_query(query: str, passage: str, *, strict: bool = False) -> bool:
    terms = _query_terms(query)
    if not terms:
        return False
    body = passage.lower()
    hits = sum(1 for t in terms if t in body)
    if strict:
        return hits >= max(2, len(terms))
    return hits >= max(1, (len(terms) + 1) // 2)


def _pick_rank_for_citation(pick: _PassagePick) -> tuple[int, int, int]:
    ts = 1 if pick.segment_type == "transcript_summary" else 0
    asr = 1 if pick.segment_type == "asr_transcript" else 0
    return (ts, asr, len(pick.excerpt or ""))


def _best_pick_per_document(picks: list[_PassagePick]) -> list[_PassagePick]:
    best: dict[int, _PassagePick] = {}
    for pick in picks:
        if pick.document_id < 1:
            continue
        prev = best.get(pick.document_id)
        if prev is None or _pick_rank_for_citation(pick) > _pick_rank_for_citation(prev):
            best[pick.document_id] = pick
    return list(best.values())


def _narrow_grounding_picks(query: str, picks: list[_PassagePick]) -> list[_PassagePick]:
    """When the user asks about meeting/audio content, do not flood context with off-topic PDF chunks."""
    summaries = [p for p in picks if p.segment_type == "transcript_summary"]
    if not summaries or not _query_wants_transcript_evidence(query):
        return picks
    others = [
        p
        for p in picks
        if p.segment_type != "transcript_summary"
        and _passage_relevant_to_query(query, p.passage, strict=True)
    ]
    return summaries + others[:1]


def _picks_for_citations(
    query: str,
    picks: list[_PassagePick],
    *,
    wants_gk: bool = False,
) -> list[_PassagePick]:
    """References list — sources the user can verify (not every retrieved chunk)."""
    candidates = [p for p in picks if _passage_relevant_to_query(query, p.passage)]
    if not candidates:
        return []
    if _query_wants_transcript_evidence(query):
        summaries = [p for p in candidates if p.segment_type == "transcript_summary"]
        asr = [p for p in candidates if p.segment_type == "asr_transcript"]
        if summaries:
            merged = _best_pick_per_document(summaries)
            summary_docs = {p.document_id for p in merged}
            for pick in _best_pick_per_document(asr):
                if pick.document_id not in summary_docs:
                    merged.append(pick)
            return merged
    return _best_pick_per_document(candidates)


def _inject_general_knowledge_only(messages: list[dict[str, Any]], *, explicit_scope: bool) -> None:
    if explicit_scope:
        _inject_system(
            messages,
            "The user scoped vault sources, but nothing retrieved answers this question. "
            "Use **one short sentence** noting the selected sources did not cover this topic, then answer "
            "**fully from general knowledge**. Do **not** bullet-list unrelated source topics. "
            "Do **not** claim you cannot access the user's private vault or knowledge base. "
            "Ephemeral files attached in chat (if any) are separate — honor attachment excerpts when present.",
        )
        return
    _inject_system(
        messages,
        "Answer this question **fully from your general training knowledge** when vault excerpts do not apply. "
        "Vault retrieval found **no on-topic passages** — do **not** mention vault-indexed documents, meeting records, "
        "or that vault sources lack the answer. Do **not** list unrelated vault topics. "
        "Do **not** claim you cannot access the user's private vault or knowledge base. "
        "Ephemeral files attached in chat (if any) are separate — honor attachment excerpts when present.",
    )


def _merge_ranked_hits(
    *groups: list[tuple[float, dict[str, Any]]],
) -> list[tuple[float, dict[str, Any]]]:
    """Merge search result lists, keeping the best score per chunk fingerprint."""
    best: dict[str, tuple[float, dict[str, Any]]] = {}
    for group in groups:
        for eff, hit in group:
            if not isinstance(hit, dict):
                continue
            txt, did, _ = _passage_from_hit(hit)
            if not txt:
                continue
            fp = f"{did}:{txt[:96]}"
            prev = best.get(fp)
            if prev is None or eff > prev[0]:
                best[fp] = (eff, hit)
    return sorted(best.values(), key=lambda pair: pair[0], reverse=True)


_GROUNDING_RECORD = (
    "The user may be asking about content stored in this workspace knowledge base. "
    "The excerpts below were retrieved for this question. "
    "Answer primarily from these excerpts, citing source labels and dates when present. "
    "Do not refuse access to the workspace knowledge base or claim you cannot see indexed sources. "
    "When excerpts directly address the question, do not replace them with unrelated generic material."
)

_GROUNDING_DEFAULT = (
    "Retrieved excerpts may supplement your answer only when they directly answer the question. "
    "Answer the user completely first. "
    "If excerpts are off-topic, ignore them silently — do not apologize about documents or list unrelated topics. "
    "For general-knowledge questions where excerpts do not define the topic, "
    "answer from training knowledge without mentioning retrieval."
)

_GROUNDING_TRANSCRIPT_SUMMARY = (
    "Excerpts tagged **Transcript summary** are curated summaries; prefer them over "
    "**ASR transcript** lines from the same source when both appear."
)

_GROUNDING_INLINE_CITATIONS = (
    "When a sentence draws on a retrieved excerpt below, place its citation marker(s) at the "
    "end of that sentence using the exact bracket indices shown (e.g. [1], [2]). "
    "Use only indices that appear in the excerpts. Do not invent citation numbers."
)

_GROUNDING_HANDBOOK = (
    "Handbook / volume excerpts below include **chapter and rule body text** from the embedded PDF. "
    "Treat numbered passages with Article/Rule/Chapter body as authoritative — build outlines and slides from them. "
    "Do **not** tell the user the vault file is 'TOC only' or 'directory only' when substantive chapter excerpts are present. "
    "Ignore index/table-of-contents lines when chapter body passages exist for the same volume."
)


_GROUNDING_RECORD_ZERO_HITS = (
    "Vault search ran but no on-topic passages were retrieved for this question. "
    "State that indexed sources did not surface a matching passage. "
    "Do not invent content unrelated to the question. "
    "Do not claim you cannot access the workspace knowledge base."
)


def _vault_rag_grounding_preamble(
    *,
    has_transcript_summary: bool,
    wants_record: bool = False,
    inline_citations: bool = False,
    handbook_turn: bool = False,
) -> str:
    parts = [_GROUNDING_RECORD if wants_record else _GROUNDING_DEFAULT]
    if handbook_turn:
        parts.append(_GROUNDING_HANDBOOK)
    if has_transcript_summary:
        parts.append(_GROUNDING_TRANSCRIPT_SUMMARY)
    if inline_citations:
        parts.append(_GROUNDING_INLINE_CITATIONS)
    return "\n\n".join(parts)


def _embedding_query_for_record_lookup(query: str) -> str:
    """Boost vector search with terms extracted from the user message (no domain-specific anchors)."""
    q = query.strip()
    if not q or not _query_wants_meeting_record(q):
        return q
    terms = _query_terms(q)
    if not terms:
        return q
    boost = " ".join(terms[:12])
    return f"{q}\n\n{boost}"


def _embedding_query_for_handbook_lookup(query: str) -> str:
    """Expand handbook / volume questions for embedding search (Vol.3 vs Volume III, etc.)."""
    q = query.strip()
    if not q:
        return q
    low = q.lower()
    extras: list[str] = []
    if "regulatory handbook" in low:
        extras.append("Regulatory Handbook")
    if any(k in low for k in ("handbook", "手冊", "manual")):
        extras.append("handbook manual 手冊")
    m = re.search(r"vol\.?\s*(\d+)", q, re.I)
    if m:
        n = str(m.group(1) or "").strip()
        if n:
            extras.extend(
                [
                    f"Volume {n}",
                    f"Vol.{n}",
                    f"Vol {n}",
                    f"第{n}卷",
                    f"第{n}冊",
                ],
            )
    elif re.search(r"第\s*[\d一二三四五六七八九十]+\s*[卷冊]", q):
        extras.append("volume 卷 冊")
    if not extras:
        return q
    return f"{q}\n\n{' '.join(extras)}"


def _handbook_chunk_is_toc_or_cover(body: str) -> bool:
    """Index / volume-list pages match 'Vol 3' in the query but are not teachable body text."""
    raw = (body or "").strip()
    low = raw.lower()
    if "table of contents" in low:
        return True
    if "volume title version" in low and "vol 1" in low:
        return True
    if low.count("vol ") >= 3 and len(low) < 900:
        return True
    # TOC leader lines: "CHAPTER 1 .............. 1" or "Annual fees .......... 33"
    if re.search(r"chapter\s+\d+[\s\.]{6,}\d", low):
        return True
    dot_line_count = len(re.findall(r"\.{6,}\s*\d+\s*$", raw, re.M))
    if dot_line_count >= 2:
        return True
    if dot_line_count >= 1 and len(raw) < 700 and "article" not in low:
        return True
    # Roman-numeral index pages (fees / section lists)
    if re.match(r"^[ivxlc]+\b", low) and re.search(r"\.{4,}\s*\d+", raw):
        return True
    # Mostly leader dots, little regulatory prose
    if raw.count(".") > max(40, len(raw) // 6):  # noqa: SIM102
        if not re.search(r"\b(shall|must|article|regulation|criteria|registered person)\b", low):
            return True
    return False


def _handbook_pick_body_text(pick: _PassagePick) -> str:
    return (pick.passage.split("\n", 1)[-1] if pick.passage else "").strip()


def _handbook_grounding_picks(
    query: str, picks: list[_PassagePick], *, limit: int
) -> list[_PassagePick]:
    """
    Handbook / Vol turns: prefer chapter/rule body chunks; drop TOC when enough body text exists.
    """
    if not picks:
        return []
    body_picks: list[_PassagePick] = []
    toc_picks: list[_PassagePick] = []
    for pick in picks:
        if _handbook_chunk_is_toc_or_cover(_handbook_pick_body_text(pick)):
            toc_picks.append(pick)
        else:
            body_picks.append(pick)

    vol3 = bool(re.search(r"vol\.?\s*3", query, re.I)) or "vol3" in query.replace(" ", "").lower()
    pool = body_picks if len(body_picks) >= max(4, limit // 4) else picks
    ranked: list[tuple[float, int, _PassagePick]] = []
    for i, pick in enumerate(pool):
        body = _handbook_pick_body_text(pick).lower()
        score = 1000.0 - float(i)
        if pick in toc_picks:
            score -= 500.0
        if vol3 and isinstance(pick.chunk_index, int) and pick.chunk_index >= 120:
            score += 80.0
        if re.search(r"\barticle\s+\d+", body):
            score += 55.0
        if re.search(r"chapter\s+\d+", body) and "...." not in body[:120]:
            score += 40.0
        if "registered person" in body:
            score += 25.0
        if re.search(r"\b\d+\.\d+\b", body):
            score += 15.0
        ranked.append((score, i, pick))
    ranked.sort(key=lambda row: (-row[0], row[1]))
    out: list[_PassagePick] = []
    seen: set[str] = set()
    for _, _, pick in ranked:
        fp = f"{pick.document_id}:{pick.chunk_index}:{pick.passage[:72]}"
        if fp in seen:
            continue
        seen.add(fp)
        if pick in toc_picks and len(out) >= max(4, limit // 2):
            continue
        out.append(pick)
        if len(out) >= limit:
            break
    return out


def _file_name_from_payload(pl: dict[str, Any]) -> str:
    for key in ("file_name", "filename", "original_name", "name"):
        v = pl.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()[:255]
    seg = pl.get("segment_label")
    if (
        isinstance(seg, str)
        and seg.strip()
        and not seg.strip().lower().startswith(("pdf page", "slide "))
    ):
        return seg.strip()[:255]
    return ""


def _int_payload(pl: dict[str, Any], key: str) -> int | None:
    raw = pl.get(key)
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    return None


def _passage_from_hit(hit: dict[str, Any]) -> tuple[str | None, int | None, str]:
    pl = hit.get("payload")
    if not isinstance(pl, dict):
        return None, None, ""
    doc_id: int | None = None
    raw_doc = pl.get("document_id")
    if isinstance(raw_doc, int):
        doc_id = raw_doc
    elif isinstance(raw_doc, str) and raw_doc.isdigit():
        doc_id = int(raw_doc)
    file_name = _file_name_from_payload(pl)
    for key in ("text", "chunk", "content", "body"):
        t = pl.get(key)
        if isinstance(t, str) and t.strip():
            return t.strip(), doc_id, file_name
    return None, doc_id, file_name


def _span_from_hit_payload(pl: dict[str, Any]) -> dict[str, Any]:
    speaker_label = str(pl.get("speaker_label") or "").strip()[:128]
    if not speaker_label:
        sid = _int_payload(pl, "speaker_id")
        if sid is not None:
            speaker_label = f"Speaker {sid + 1}"
    return {
        "chunk_index": _int_payload(pl, "chunk_index"),
        "segment_index": _int_payload(pl, "segment_index"),
        "begin_ms": _int_payload(pl, "begin_ms"),
        "end_ms": _int_payload(pl, "end_ms"),
        "speaker_id": _int_payload(pl, "speaker_id"),
        "speaker_label": speaker_label,
    }


def _passage_pick_from_hit(hit: dict[str, Any], *, vault_id: int) -> _PassagePick | None:
    txt, did, fname = _passage_from_hit(hit)
    if not txt:
        return None
    pl = hit.get("payload")
    seg_type = _segment_type_from_payload(pl) if isinstance(pl, dict) else None
    span = _span_from_hit_payload(pl) if isinstance(pl, dict) else {}
    doc_id = int(did) if isinstance(did, int) and did > 0 else 0
    excerpt = re.sub(r"\s+", " ", txt.split("\n", 1)[-1]).strip()[:240]
    return _PassagePick(
        passage=_format_passage_block(vault_id, did, seg_type, txt),
        vault_id=vault_id,
        document_id=doc_id,
        file_name=fname,
        segment_type=seg_type,
        chunk_index=span.get("chunk_index"),
        segment_index=span.get("segment_index"),
        begin_ms=span.get("begin_ms"),
        end_ms=span.get("end_ms"),
        speaker_id=span.get("speaker_id"),
        speaker_label=str(span.get("speaker_label") or ""),
        excerpt=excerpt,
    )


def _source_ref_name_map(
    vault_source_refs: list[dict[str, Any]] | None,
) -> dict[tuple[int, int], str]:
    out: dict[tuple[int, int], str] = {}
    for raw in vault_source_refs or []:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("kind") or "").strip().lower() != "document":
            continue
        try:
            vid = int(raw.get("vault_id") or 0)
            did = int(raw.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if vid < 1 or did < 1:
            continue
        name = str(raw.get("name") or "").strip()
        if name:
            out[(vid, did)] = name[:255]
    return out


def _catalog_entry_map(catalog: dict[str, Any] | None) -> dict[tuple[int, int], dict[str, str]]:
    out: dict[tuple[int, int], dict[str, str]] = {}
    if not isinstance(catalog, dict):
        return out
    for raw_key, raw_val in catalog.items():
        if not isinstance(raw_val, dict):
            continue
        parts = str(raw_key).split(":", 1)
        if len(parts) != 2:
            continue
        try:
            vid = int(parts[0])
            did = int(parts[1])
        except (TypeError, ValueError):
            continue
        if vid < 1 or did < 1:
            continue
        out[(vid, did)] = {
            "file_name": str(raw_val.get("file_name") or "").strip()[:255],
            "vault_name": str(raw_val.get("vault_name") or "").strip()[:255],
            "path": str(raw_val.get("path") or "").strip()[:512],
        }
    return out


def _append_citation(
    refs: list[VaultRagCitation],
    *,
    pick: _PassagePick,
    ref_names: dict[tuple[int, int], str],
    catalog_entries: dict[tuple[int, int], dict[str, str]],
) -> None:
    if pick.document_id < 1:
        return
    key = (pick.vault_id, pick.document_id)
    cat = catalog_entries.get(key) or {}
    resolved = (pick.file_name or ref_names.get(key) or cat.get("file_name") or "").strip()
    vault_name = str(cat.get("vault_name") or "").strip()
    path = str(cat.get("path") or "").strip()
    chunk_index = pick.chunk_index
    begin_ms = pick.begin_ms
    for prev in refs:
        if (
            prev.vault_id == pick.vault_id
            and prev.document_id == pick.document_id
            and prev.chunk_index == chunk_index
            and prev.begin_ms == begin_ms
        ):
            if resolved and (not prev.file_name or len(resolved) > len(prev.file_name)):
                prev.file_name = resolved
            if pick.excerpt and (not prev.excerpt or len(pick.excerpt) > len(prev.excerpt)):
                prev.excerpt = pick.excerpt
            st = pick.segment_type
            if st and st not in prev.segment_types:
                prev.segment_types.append(st)
            return
    seg_types = [pick.segment_type] if pick.segment_type else []
    refs.append(
        VaultRagCitation(
            vault_id=pick.vault_id,
            document_id=pick.document_id,
            file_name=resolved,
            vault_name=vault_name,
            path=path,
            segment_types=seg_types,
            chunk_index=chunk_index,
            segment_index=pick.segment_index,
            begin_ms=begin_ms,
            end_ms=pick.end_ms,
            speaker_id=pick.speaker_id,
            speaker_label=pick.speaker_label,
            excerpt=pick.excerpt,
        ),
    )


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

    if all_picks and not handbook_turn and not wants_record and not explicit_scope and not vault_rescan:
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
