"""Vault RAG passage selection, scoring, and citation helpers (W7-S2 phase 2)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from oaao_orchestrator.vault_rag.embed import _env
from oaao_orchestrator.vault_rag.messages import inject_system_message
from oaao_orchestrator.vault_rag.types import VaultRagCitation

# Back-compat alias used by qdrant scroll helpers.

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


def _format_numbered_passage_block(cite_index: int, pick: PassagePick, body: str) -> str:
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
    pick: PassagePick,
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
class PassagePick:
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
    score: float = 0.0


async def _rerank_passage_picks(
    query: str,
    picks: list[PassagePick],
    rerank_cfg: dict[str, Any] | None,
    *,
    top_n: int,
) -> list[PassagePick]:
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
    picks: list[PassagePick],
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
    by_doc: dict[tuple[int, int], list[PassagePick]] = {}
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


def _format_passage_detail_line(pick: PassagePick) -> str:
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
) -> tuple[list[PassagePick], int]:
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

    picks: list[PassagePick] = []
    docs_with_summary: set[int] = set()
    for did, (eff, hit) in sorted(
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
        pick.score = float(eff)
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
        pick.score = float(eff)
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


def _pick_rank_for_citation(pick: PassagePick) -> tuple[int, int, int]:
    ts = 1 if pick.segment_type == "transcript_summary" else 0
    asr = 1 if pick.segment_type == "asr_transcript" else 0
    return (ts, asr, len(pick.excerpt or ""))


def _best_pick_per_document(picks: list[PassagePick]) -> list[PassagePick]:
    best: dict[int, PassagePick] = {}
    for pick in picks:
        if pick.document_id < 1:
            continue
        prev = best.get(pick.document_id)
        if prev is None or _pick_rank_for_citation(pick) > _pick_rank_for_citation(prev):
            best[pick.document_id] = pick
    return list(best.values())


def _narrow_grounding_picks(query: str, picks: list[PassagePick]) -> list[PassagePick]:
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
    picks: list[PassagePick],
    *,
    wants_gk: bool = False,
) -> list[PassagePick]:
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
        inject_system_message(
            messages,
            "The user scoped vault sources, but nothing retrieved answers this question. "
            "Use **one short sentence** noting the selected sources did not cover this topic, then answer "
            "**fully from general knowledge**. Do **not** bullet-list unrelated source topics. "
            "Do **not** claim you cannot access the user's private vault or knowledge base. "
            "Ephemeral files attached in chat (if any) are separate — honor attachment excerpts when present.",
        )
        return
    inject_system_message(
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


GROUNDING_RECORD_ZERO_HITS = (
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


def _handbook_pick_body_text(pick: PassagePick) -> str:
    return (pick.passage.split("\n", 1)[-1] if pick.passage else "").strip()


def _handbook_grounding_picks(
    query: str, picks: list[PassagePick], *, limit: int
) -> list[PassagePick]:
    """
    Handbook / Vol turns: prefer chapter/rule body chunks; drop TOC when enough body text exists.
    """
    if not picks:
        return []
    body_picks: list[PassagePick] = []
    toc_picks: list[PassagePick] = []
    for pick in picks:
        if _handbook_chunk_is_toc_or_cover(_handbook_pick_body_text(pick)):
            toc_picks.append(pick)
        else:
            body_picks.append(pick)

    vol3 = bool(re.search(r"vol\.?\s*3", query, re.I)) or "vol3" in query.replace(" ", "").lower()
    pool = body_picks if len(body_picks) >= max(4, limit // 4) else picks
    ranked: list[tuple[float, int, PassagePick]] = []
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
    out: list[PassagePick] = []
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


def _passage_pick_from_hit(hit: dict[str, Any], *, vault_id: int) -> PassagePick | None:
    txt, did, fname = _passage_from_hit(hit)
    if not txt:
        return None
    pl = hit.get("payload")
    seg_type = _segment_type_from_payload(pl) if isinstance(pl, dict) else None
    span = _span_from_hit_payload(pl) if isinstance(pl, dict) else {}
    doc_id = int(did) if isinstance(did, int) and did > 0 else 0
    excerpt = re.sub(r"\s+", " ", txt.split("\n", 1)[-1]).strip()[:240]
    return PassagePick(
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
    pick: PassagePick,
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


_PassagePick = PassagePick
select_passages_for_vault = _select_passages_for_vault


def query_wants_meeting_record(query: str) -> bool:
    return _query_wants_meeting_record(query)


def grounding_record_zero_hits_text() -> str:
    return GROUNDING_RECORD_ZERO_HITS
