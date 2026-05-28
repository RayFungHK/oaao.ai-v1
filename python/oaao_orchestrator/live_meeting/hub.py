"""In-memory session registry — WS audio ingest, dual ASR paths, SSE broadcast.

Dual-path product model (UX + accuracy):

1. **Live ASR** (``asr.live`` streaming WS): partial/final tokens for immediate composer UX.
2. **Batch ASR** (``asr.*`` ~5 s PCM segments): closed ``seg_*.pcm`` → ``POST /transcribe`` for accuracy.

Both paths run **in parallel** when configured. Stop-time polish reconciles batch transcript
with live streaming chunks (see ``polish_transcript_with_live_refs``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fastapi import WebSocket, WebSocketDisconnect

from oaao_orchestrator.live_meeting.audio_store import BYTES_PER_SAMPLE, SAMPLE_RATE, SegmentWriter
from oaao_orchestrator.live_meeting.bubble_engine import (
    cadence_interval_sec,
    extract_bubbles,
)
from oaao_orchestrator.live_meeting.bubble_rag import lookup_bubble_vault
from oaao_orchestrator.live_meeting.dashscope_asr_stream import dashscope_api_key
from oaao_orchestrator.live_meeting.qwen_asr_stream import (
    is_streaming_asr_mode,
    segment_transcribe_asr_cfg,
    transcribe_live_pcm_segment,
)
from oaao_orchestrator.live_meeting.session import (
    LiveMeetingSession,
    live_meeting_root,
    new_session_id,
)
from oaao_orchestrator.live_meeting.sse_hub import drop_live_stream, get_live_stream
from oaao_orchestrator.live_meeting.stream_bridge import (
    LiveStreamAsrBridge,
    create_and_start_live_stream_bridge,
    resolve_live_stream_ws_url,
    resolve_stream_driver,
)
from oaao_orchestrator.polish_assess import (
    is_substantive_llm_polish,
    polish_weak_output,
    score_polish_quality,
)
from oaao_orchestrator.quick_punctuate import (
    finalize_polish_output,
    load_quick_punctuate_rules,
    punctuation_score as qp_punctuation_score,
    sentence_break_score as qp_sentence_break_score,
)
from oaao_orchestrator.asr_common import (
    extract_polish_llm_content,
    has_batch_transcribe_config,
    merge_asr_transcripts_for_polish,
    normalize_polish_style,
    polish_transcript,
    polish_transcript_with_live_refs,
    quick_punctuate_transcript,
    sanitize_asr_transcript_text,
)
from oaao_orchestrator.streaming.events import (
    KIND_ERROR,
    KIND_LIVE_BUBBLE,
    KIND_LIVE_MATERIALS,
    KIND_LIVE_PHASE,
    KIND_LIVE_STATS,
    KIND_LIVE_TRANSCRIPT,
    PHASE_LIVE,
    StreamEnvelope,
)
from oaao_orchestrator.stream_token import StreamTokenStore

logger = logging.getLogger(__name__)

_active: dict[str, LiveMeetingSession] = {}
_writers: dict[str, SegmentWriter] = {}
_asr_tasks: dict[str, set[asyncio.Task[Any]]] = {}
_bridges: dict[str, LiveStreamAsrBridge] = {}
_bridge_emit_at: dict[str, float] = {}
_stream_silent_tasks: dict[str, asyncio.Task[Any]] = {}
_partial_seq: dict[str, int] = {}
_polish_pending: dict[str, int] = {}
_last_bubble_emit: dict[str, float] = {}
# W10-S3: per-session stream tokens for live SSE / WS auth.
_stream_tokens: StreamTokenStore = StreamTokenStore()

STREAM_SILENT_TIMEOUT_SEC = 12.0


@dataclass
class _SessionRuntime:
    session: LiveMeetingSession
    asr_cfg: dict[str, Any] | None
    glossary: dict[str, Any] | None
    asr_fallback_cfg: dict[str, Any] | None = None
    polish_cfg: dict[str, Any] | None = None
    locale: str = "en"
    polish_style: str = "natural"
    vault_retrieval_profiles: list[dict[str, Any]] | None = None
    embedding: dict[str, Any] | None = None
    vault_rag_config: dict[str, Any] | None = None
    carry_prompt: str = ""
    live_text_best: str = ""
    live_asr_chunks: list[str] = field(default_factory=list)
    batch_asr_by_seg: dict[int, str] = field(default_factory=dict)
    bubble_evidence_totals: dict[str, int] = field(default_factory=dict)


_runtime: dict[str, _SessionRuntime] = {}


def _live_stats_payload(
    *,
    bubble_id: str,
    evidence_total: int,
    passage_count: int,
    runtime: _SessionRuntime,
) -> dict[str, Any]:
    prev = int(runtime.bubble_evidence_totals.get(bubble_id) or 0)
    delta = max(0, evidence_total - prev)
    runtime.bubble_evidence_totals[bubble_id] = evidence_total
    return {
        "bubble_id": bubble_id,
        "evidence_total": evidence_total,
        "passage_count": passage_count,
        "delta": delta,
    }


def _normalize_session_locale(locale: str | None) -> str:
    loc = str(locale or "en").strip()
    return loc if loc else "en"


def _polish_cfg_for_runtime(runtime: _SessionRuntime | None) -> dict[str, Any]:
    if runtime is None:
        return {}
    cfg = dict(runtime.polish_cfg or {})
    loc = _normalize_session_locale(runtime.locale)
    if loc:
        cfg["locale"] = loc
        cfg["display_locale"] = loc
    style = normalize_polish_style(runtime.polish_style)
    if style:
        cfg["polish_style"] = style
    return cfg


def create_session(
    *,
    cadence: str = "1v1",
    retention_mode: str = "disk_ttl",
    workspace_id: int | None = None,
    user_id: int | None = None,
    asr_cfg: dict[str, Any] | None = None,
    asr_fallback_cfg: dict[str, Any] | None = None,
    polish_cfg: dict[str, Any] | None = None,
    locale: str | None = None,
    polish_style: str | None = None,
    glossary: dict[str, Any] | None = None,
    vault_retrieval_profiles: list[dict[str, Any]] | None = None,
    embedding: dict[str, Any] | None = None,
    vault_rag_config: dict[str, Any] | None = None,
) -> LiveMeetingSession:
    root = live_meeting_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / "sessions").mkdir(parents=True, exist_ok=True)
    session = LiveMeetingSession(
        session_id=new_session_id(),
        root=root,
        cadence=(cadence or "1v1").strip() or "1v1",
        retention_mode=(retention_mode or "disk_ttl").strip() or "disk_ttl",
        workspace_id=workspace_id,
        user_id=user_id,
        asr_cfg=asr_cfg,
    )
    session.ensure_dirs()
    session.write_meta()
    _active[session.session_id] = session
    profiles = (
        [p for p in vault_retrieval_profiles if isinstance(p, dict)]
        if isinstance(vault_retrieval_profiles, list)
        else None
    )
    _runtime[session.session_id] = _SessionRuntime(
        session=session,
        asr_cfg=asr_cfg if isinstance(asr_cfg, dict) else None,
        glossary=glossary if isinstance(glossary, dict) else None,
        asr_fallback_cfg=asr_fallback_cfg if isinstance(asr_fallback_cfg, dict) else None,
        polish_cfg=polish_cfg if isinstance(polish_cfg, dict) else None,
        locale=_normalize_session_locale(locale),
        polish_style=normalize_polish_style(polish_style),
        vault_retrieval_profiles=profiles or None,
        embedding=embedding if isinstance(embedding, dict) else None,
        vault_rag_config=vault_rag_config if isinstance(vault_rag_config, dict) else None,
    )
    get_live_stream(session.session_id)
    driver = resolve_stream_driver(asr_cfg)
    if driver:
        logger.info(
            "live_meeting stream_bridge id=%s driver=%s model=%s",
            session.session_id,
            driver,
            (asr_cfg or {}).get("model"),
        )
    elif is_streaming_asr_mode(asr_cfg):
        logger.info(
            "live_meeting segment_batch_fallback id=%s provider=%s (no stream URL / driver)",
            session.session_id,
            (asr_cfg or {}).get("provider"),
        )
    logger.info(
        "live_meeting session_created id=%s workspace_id=%s", session.session_id, workspace_id
    )
    return session


def get_session(session_id: str) -> LiveMeetingSession | None:
    sid = (session_id or "").strip()
    if not sid:
        return None
    if sid in _active:
        return _active[sid]
    loaded = LiveMeetingSession.load(sid)
    if loaded is not None:
        _active[sid] = loaded
    return loaded


def _track_asr_task(session_id: str, task: asyncio.Task[Any]) -> None:
    bucket = _asr_tasks.setdefault(session_id, set())
    bucket.add(task)

    def _done(t: asyncio.Task[Any]) -> None:
        bucket.discard(t)

    task.add_done_callback(_done)


def _append_transcript_line(session: LiveMeetingSession, record: dict[str, Any]) -> None:
    line = json.dumps(record, ensure_ascii=False)
    with session.transcript_path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _live_polish_enabled(runtime: _SessionRuntime | None) -> bool:
    if runtime is None or not isinstance(runtime.polish_cfg, dict):
        return False
    flag = os.environ.get("OAAO_LIVE_ASR_POLISH", "1").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    cfg = runtime.polish_cfg
    model = str(cfg.get("model") or "").strip()
    base = str(cfg.get("base_url") or cfg.get("url") or "").strip()
    return bool(model and base)


def _live_segment_polish_enabled() -> bool:
    """Per-segment bubble polish during recording (default off — composer uses stop-time polish)."""
    flag = os.environ.get("OAAO_LIVE_SEGMENT_POLISH", "0").strip().lower()
    return flag in ("1", "true", "yes", "on")


async def _finalize_live_segment_carry(
    session_id: str, text: str, *, raw_text: str | None = None
) -> None:
    runtime = _runtime.get(session_id)
    if runtime is None:
        return
    cleaned = (raw_text or text or "").strip()
    if not cleaned:
        return
    if runtime.carry_prompt:
        runtime.carry_prompt = f"{runtime.carry_prompt}\n{cleaned}"[-800:]
    else:
        runtime.carry_prompt = cleaned[:800]
    await _maybe_emit_bubbles(session_id)


def _session_transcript_plain(session: LiveMeetingSession) -> str:
    path = session.transcript_path
    if not path.is_file():
        return ""
    by_seg: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not rec.get("is_final"):
            continue
        text = str(rec.get("text") or "").strip()
        if not text:
            continue
        seg_raw = rec.get("segment")
        try:
            seg_key = int(seg_raw)
        except (TypeError, ValueError):
            seg_key = len(by_seg) + 1
        is_polished = bool(rec.get("polished"))
        if is_polished or seg_key not in by_seg:
            by_seg[seg_key] = text
    if not by_seg:
        return ""
    return " ".join(by_seg[k] for k in sorted(by_seg)).strip()


def _session_transcript_raw_plain(session: LiveMeetingSession) -> str:
    path = session.transcript_path
    if not path.is_file():
        return ""
    by_seg: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not rec.get("is_final"):
            continue
        seg_raw = rec.get("segment")
        try:
            seg_key = int(seg_raw)
        except (TypeError, ValueError):
            seg_key = len(by_seg) + 1
        is_polished = bool(rec.get("polished"))
        if is_polished:
            raw_hint = str(rec.get("raw_text") or "").strip()
            if raw_hint:
                by_seg[seg_key] = raw_hint
            continue
        text = str(rec.get("text") or "").strip()
        if text:
            by_seg[seg_key] = text
    if not by_seg:
        return ""
    return " ".join(by_seg[k] for k in sorted(by_seg)).strip()


def _carry_prompt_longest(carry: str) -> str:
    cleaned = (carry or "").strip()
    if not cleaned:
        return ""
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    if not lines:
        return ""
    return max(lines, key=len)


def _is_batch_asr_source(source: str) -> bool:
    src = (source or "").strip().lower()
    return src == "batch_segment" or src.startswith("batch_") or src.startswith("session_stop_")


def _is_live_asr_source(source: str) -> bool:
    return not _is_batch_asr_source(source)


def _note_live_transcript_memory(runtime: _SessionRuntime, text: str) -> None:
    """Keep the longest live partial/final — streaming ASR partials are usually cumulative."""
    cleaned = (text or "").strip()
    if cleaned and len(cleaned) >= len(runtime.live_text_best):
        runtime.live_text_best = cleaned
    _note_live_asr_chunk(runtime, cleaned)


def _note_batch_asr_segment(runtime: _SessionRuntime, segment_index: int, text: str) -> None:
    cleaned = (text or "").strip()
    if not cleaned:
        return
    runtime.batch_asr_by_seg[int(segment_index)] = cleaned


def _join_batch_segment_texts(parts: list[str]) -> str:
    cleaned = [p.strip() for p in parts if p and str(p).strip()]
    return " ".join(cleaned).strip()


def _resolve_batch_asr_plain(session: LiveMeetingSession, runtime: _SessionRuntime) -> str:
    if runtime.batch_asr_by_seg:
        return _join_batch_segment_texts(
            [runtime.batch_asr_by_seg[k] for k in sorted(runtime.batch_asr_by_seg)]
        )
    return _join_batch_segment_texts(_session_transcript_segment_texts(session, track="batch"))


def _note_live_asr_chunk(runtime: _SessionRuntime, text: str) -> None:
    """Append streaming partial/final chunks for stop-time reconciliation."""
    cleaned = (text or "").strip()
    if not cleaned:
        return
    chunks = runtime.live_asr_chunks
    if chunks and chunks[-1] == cleaned:
        return
    if chunks and cleaned.startswith(chunks[-1]):
        chunks[-1] = cleaned
        return
    if chunks and chunks[-1].startswith(cleaned):
        return
    chunks.append(cleaned)


def _session_transcript_segment_texts(
    session: LiveMeetingSession,
    *,
    track: str = "all",
) -> list[str]:
    path = session.transcript_path
    if not path.is_file():
        return []
    by_seg: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not rec.get("is_final"):
            continue
        src = str(rec.get("source") or "")
        is_batch = _is_batch_asr_source(src)
        if track == "batch" and not is_batch:
            continue
        if track == "live" and is_batch:
            continue
        seg_raw = rec.get("segment")
        try:
            seg_key = int(seg_raw)
        except (TypeError, ValueError):
            seg_key = len(by_seg) + 1
        is_polished = bool(rec.get("polished"))
        if is_polished and track != "batch":
            raw_hint = str(rec.get("raw_text") or "").strip()
            text = raw_hint or str(rec.get("text") or "").strip()
        elif is_polished:
            raw_hint = str(rec.get("raw_text") or "").strip()
            text = raw_hint or str(rec.get("text") or "").strip()
        else:
            text = str(rec.get("text") or "").strip()
        if text:
            by_seg[seg_key] = text
    return [by_seg[k] for k in sorted(by_seg)]


def _dedupe_live_asr_chunks(chunks: list[str]) -> list[str]:
    out: list[str] = []
    for raw in chunks:
        c = (raw or "").strip()
        if not c:
            continue
        if out and out[-1] == c:
            continue
        if out and c.startswith(out[-1]):
            out[-1] = c
            continue
        if out and out[-1].startswith(c):
            continue
        out.append(c)
    return out


def _merge_text_chunks(chunks: list[str]) -> str:
    cleaned = _dedupe_live_asr_chunks(chunks)
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    merged = cleaned[0]
    for part in cleaned[1:]:
        if not part or part == merged:
            continue
        if part in merged or merged in part:
            merged = part if len(part) >= len(merged) else merged
            continue
        merged = f"{merged} {part}".strip()
    return merged


def _collect_live_asr_chunks(
    session: LiveMeetingSession,
    runtime: _SessionRuntime,
    *,
    client_live_text: str | None = None,
    client_live_chunks: list[str] | None = None,
) -> list[str]:
    candidates: list[str] = []
    candidates.extend(_session_transcript_segment_texts(session, track="live"))
    for line in (runtime.carry_prompt or "").splitlines():
        line = line.strip()
        if line:
            candidates.append(line)
    candidates.extend(runtime.live_asr_chunks)
    if client_live_chunks:
        candidates.extend(str(c).strip() for c in client_live_chunks if c and str(c).strip())
    if client_live_text:
        candidates.append(client_live_text.strip())
    if runtime.live_text_best:
        candidates.append(runtime.live_text_best.strip())
    return _dedupe_live_asr_chunks(candidates)


def _resolve_session_raw_plain(
    session: LiveMeetingSession,
    runtime: _SessionRuntime,
    *,
    client_live_text: str | None = None,
) -> str:
    parts = [
        _session_transcript_raw_plain(session),
        (runtime.live_text_best or "").strip(),
        _carry_prompt_longest(runtime.carry_prompt or ""),
        (client_live_text or "").strip(),
    ]
    parts = [p for p in parts if p]
    if not parts:
        return ""
    return max(parts, key=len)


def _session_pcm_paths(session: LiveMeetingSession) -> list[Path]:
    audio_dir = session.audio_dir
    if not audio_dir.is_dir():
        return []
    return sorted(audio_dir.glob("seg_*.pcm"))


async def _transcribe_session_pcm_rollup(
    session_id: str,
    session: LiveMeetingSession,
    runtime: _SessionRuntime,
) -> str | None:
    pcm_paths = _session_pcm_paths(session)
    if not pcm_paths:
        return None
    import tempfile

    combined = Path(tempfile.gettempdir()) / f"oaao_live_{session_id}.pcm"
    try:
        total = 0
        with combined.open("wb") as out:
            for pcm_path in pcm_paths:
                blob = pcm_path.read_bytes()
                if not blob:
                    continue
                out.write(blob)
                total += len(blob)
        min_bytes = SAMPLE_RATE * BYTES_PER_SAMPLE
        if total < min_bytes:
            return None
        seg_asr_cfg = segment_transcribe_asr_cfg(runtime.asr_cfg, runtime.asr_fallback_cfg)
        text, err = await transcribe_live_pcm_segment(
            pcm_path=combined,
            asr_cfg=seg_asr_cfg or runtime.asr_cfg or {},
            glossary=runtime.glossary,
        )
        if err or not text:
            logger.info(
                "live_meeting session_pcm_rollup_empty id=%s err=%s bytes=%s",
                session_id,
                err,
                total,
            )
            return None
        logger.info(
            "live_meeting session_pcm_rollup id=%s chars=%s bytes=%s segs=%s",
            session_id,
            len(text.strip()),
            total,
            len(pcm_paths),
        )
        return text.strip()
    finally:
        combined.unlink(missing_ok=True)


def _punctuation_score(text: str) -> int:
    return len(re.findall(r"[，。！？、；：,.!?]", text or ""))


def _finalize_polished_text(polished: str, display_raw: str) -> str:
    return finalize_polish_output(polished, display_raw)


def _looks_llm_polished(polished: str, display_raw: str, *, locale: str = "") -> bool:
    pol = (polished or "").strip()
    raw = (display_raw or "").strip()
    if not pol or not is_substantive_llm_polish(raw, pol, locale=locale):
        return False
    if qp_sentence_break_score(pol) >= 2:
        return True
    if qp_punctuation_score(pol) >= 2 and qp_punctuation_score(pol) > qp_punctuation_score(raw):
        return True
    return False


def _should_reject_truncated_polish(
    polished: str,
    display_raw: str,
    *,
    baseline_len: int,
    locale: str = "",
) -> bool:
    pol_len = len((polished or "").strip())
    if baseline_len < 24 or pol_len >= baseline_len * 0.72:
        return False
    if _looks_llm_polished(polished, display_raw, locale=locale):
        return False
    return True


def _collect_batch_asr_chunks(
    session: LiveMeetingSession,
    runtime: _SessionRuntime,
    *,
    client_batch_chunks: list[str] | None = None,
) -> list[str]:
    chunks: list[str] = []
    if runtime.batch_asr_by_seg:
        chunks.extend(runtime.batch_asr_by_seg[k] for k in sorted(runtime.batch_asr_by_seg))
    if not chunks:
        chunks.extend(_session_transcript_segment_texts(session, track="batch"))
    if client_batch_chunks:
        for raw in client_batch_chunks:
            line = str(raw).strip()
            if line:
                chunks.append(line)
    return _dedupe_live_asr_chunks(chunks)


def _polish_quality_score(raw: str, polished: str, *, locale: str = "") -> int:
    return score_polish_quality(raw, polished, locale=locale)


def _transcript_stats_skeleton(
    *,
    batch_plain: str,
    live_plain: str,
    batch_chunks: list[str],
    live_chunks: list[str],
    display_raw: str,
    polish_mode: str,
    locale: str = "en",
) -> dict[str, Any]:
    return {
        "batch_chars": len((batch_plain or "").strip()),
        "live_chars": len((live_plain or "").strip()),
        "batch_chunk_count": len(batch_chunks),
        "live_chunk_count": len(live_chunks),
        "raw_chars": len((display_raw or "").strip()),
        "polished_chars": 0,
        "polish_quality": 0,
        "polish_mode": polish_mode,
        "polish_phase": "raw",
        "polish_error": None,
        "polished_text": None,
        "locale": _normalize_session_locale(locale),
    }


async def _maybe_full_session_polish_on_stop(
    session_id: str,
    session: LiveMeetingSession,
    runtime: _SessionRuntime,
    *,
    client_live_text: str | None = None,
    client_live_chunks: list[str] | None = None,
    client_batch_chunks: list[str] | None = None,
) -> dict[str, Any]:
    """
    Stop-time transcript finalize:

    1. Batch ASR — accumulated ~5 s segment transcripts (+ PCM rollup fallback)
    2. Live ASR — streaming partial/final chunks from client + server memory
    3. Polish — reconcile batch + live when both exist; live-only when batch absent
    """
    if client_live_text:
        _note_live_transcript_memory(runtime, client_live_text.strip())
    if client_live_chunks:
        for chunk in client_live_chunks:
            _note_live_asr_chunk(runtime, str(chunk))

    live_chunks = _collect_live_asr_chunks(
        session,
        runtime,
        client_live_text=client_live_text,
        client_live_chunks=client_live_chunks,
    )
    live_plain = _resolve_session_raw_plain(
        session, runtime, client_live_text=client_live_text
    )
    if live_chunks:
        longest_chunk = max(live_chunks, key=len)
        if len(longest_chunk) > len(live_plain):
            live_plain = longest_chunk

    batch_chunks = _collect_batch_asr_chunks(
        session,
        runtime,
        client_batch_chunks=client_batch_chunks,
    )
    batch_plain = _join_batch_segment_texts(batch_chunks)
    seg_asr_cfg = segment_transcribe_asr_cfg(runtime.asr_cfg, runtime.asr_fallback_cfg)
    client_has_transcript = bool((client_live_text or "").strip()) or bool(client_batch_chunks)
    if (
        not batch_plain
        and not client_has_transcript
        and not live_plain
        and isinstance(seg_asr_cfg, dict)
        and has_batch_transcribe_config(seg_asr_cfg)
        and _session_pcm_paths(session)
    ):
        batch_plain = await _transcribe_session_pcm_rollup(session_id, session, runtime) or ""

    if batch_plain:
        raw_plain = batch_plain
        polish_mode = "asr_with_live"
    elif live_plain:
        raw_plain = live_plain
        polish_mode = "live_only"
    else:
        return {}

    if len(raw_plain) < 2:
        return {}

    baseline_len = max(len(batch_plain or ""), len(live_plain or ""), len(raw_plain))
    transcript_only = _session_transcript_raw_plain(session)
    display_raw = raw_plain
    if live_plain and len(live_plain) > len(display_raw):
        display_raw = live_plain
    if batch_plain and len(batch_plain) > len(display_raw):
        display_raw = batch_plain

    stats = _transcript_stats_skeleton(
        batch_plain=batch_plain,
        live_plain=live_plain,
        batch_chunks=batch_chunks,
        live_chunks=live_chunks,
        display_raw=display_raw,
        polish_mode=polish_mode,
        locale=runtime.locale,
    )

    if len(display_raw) > len(transcript_only) + 8 and not _live_polish_enabled(runtime):
        await _emit_live_transcript(
            session_id,
            display_raw,
            is_final=True,
            source=f"session_stop_{polish_mode}",
            segment=999998,
            skip_polish=True,
            full_session_polish=True,
        )

    if not _live_polish_enabled(runtime):
        if batch_plain or live_plain:
            final_text = quick_punctuate_transcript(display_raw)
            stats["polished_text"] = final_text
            stats["polished_chars"] = len(final_text)
            stats["polish_quality"] = _polish_quality_score(display_raw, final_text, locale=runtime.locale)
            stats["polish_phase"] = "quick"
            await _emit_live_transcript(
                session_id,
                final_text,
                is_final=True,
                source=f"session_stop_{polish_mode}",
                segment=999999,
                skip_polish=True,
                full_session_polish=True,
            )
        return stats

    use_live_fast = (
        polish_mode == "asr_with_live"
        and live_plain
        and len(live_plain) >= max(int(len(batch_plain or "") * 0.8), len(batch_plain or "") - 12)
    )
    if use_live_fast:
        polish_mode = "live_fast"

    polished: str | None = None
    perr: str | None = None
    polish_input = display_raw
    try:
        async with httpx.AsyncClient() as client:
            if use_live_fast or polish_mode == "live_only":
                polish_input = live_plain
                polished, perr = await polish_transcript(
                    client,
                    raw_text=live_plain,
                    polish_cfg=_polish_cfg_for_runtime(runtime),
                    glossary=runtime.glossary,
                )
            elif batch_plain:
                polish_input = merge_asr_transcripts_for_polish(
                    asr_text=batch_plain,
                    batch_chunks=batch_chunks,
                    live_chunks=live_chunks,
                )
                polished, perr = await polish_transcript_with_live_refs(
                    client,
                    asr_text=batch_plain,
                    live_chunks=live_chunks,
                    batch_chunks=batch_chunks,
                    polish_cfg=_polish_cfg_for_runtime(runtime),
                    glossary=runtime.glossary,
                )
            else:
                polish_input = live_plain
                polished, perr = await polish_transcript(
                    client,
                    raw_text=live_plain,
                    polish_cfg=_polish_cfg_for_runtime(runtime),
                    glossary=runtime.glossary,
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "live_meeting session_stop_polish_failed id=%s mode=%s err=%s",
            session_id,
            polish_mode,
            exc,
        )
        polished = quick_punctuate_transcript(display_raw)
        perr = str(exc)[:200]

    if perr and not polished:
        polished = quick_punctuate_transcript(display_raw)
    if not polished:
        polished = quick_punctuate_transcript(display_raw)
        perr = perr or "polish_empty"

    loc = _normalize_session_locale(runtime.locale)
    llm_out = ""
    if not perr:
        llm_out = extract_polish_llm_content((polished or "").strip())

    if (
        not perr
        and llm_out
        and polish_weak_output(polish_input, llm_out, locale=loc)
    ):
        logger.info(
            "live_meeting session_stop_polish_retry id=%s mode=%s in_chars=%s out_chars=%s",
            session_id,
            polish_mode,
            len(polish_input),
            len(llm_out),
        )
        try:
            async with httpx.AsyncClient() as retry_client:
                retry_polished, retry_perr = await polish_transcript(
                    retry_client,
                    raw_text=polish_input,
                    polish_cfg=_polish_cfg_for_runtime(runtime),
                    glossary=runtime.glossary,
                )
            if not retry_perr and retry_polished:
                retry_out = extract_polish_llm_content(retry_polished.strip())
                if retry_out and is_substantive_llm_polish(polish_input, retry_out, locale=loc):
                    llm_out = retry_out
                    perr = None
                elif retry_out:
                    llm_out = retry_out
            elif retry_perr:
                perr = retry_perr
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "live_meeting session_stop_polish_retry_failed id=%s err=%s",
                session_id,
                exc,
            )

    if perr:
        polished = quick_punctuate_transcript(display_raw)
        stats["polish_phase"] = "quick"
        stats["polish_error"] = perr
    elif llm_out and is_substantive_llm_polish(polish_input, llm_out, locale=loc):
        polished = llm_out
        stats["polish_phase"] = "llm"
    else:
        polished = quick_punctuate_transcript(display_raw)
        stats["polish_phase"] = "quick"
        if llm_out:
            stats["polish_error"] = "polish_no_substantive_change"
            logger.warning(
                "live_meeting session_stop_polish_unchanged id=%s mode=%s in_chars=%s out_chars=%s",
                session_id,
                polish_mode,
                len(polish_input),
                len(llm_out),
            )
        else:
            stats["polish_error"] = perr or "polish_empty"

    stats["polished_text"] = polished
    stats["polished_chars"] = len(polished)
    stats["polish_quality"] = _polish_quality_score(polish_input, polished, locale=runtime.locale)
    stop_stats = {
        "polish_phase": stats["polish_phase"],
        "polish_quality": stats["polish_quality"],
        "polish_error": stats.get("polish_error"),
        "polished_text": polished,
        "polished_chars": stats["polished_chars"],
        "raw_chars": stats.get("raw_chars", len(display_raw)),
        "locale": _normalize_session_locale(runtime.locale),
    }
    await _emit_live_transcript(
        session_id,
        polished,
        is_final=True,
        source=f"session_stop_polish_{polish_mode}",
        segment=999999,
        skip_polish=True,
        polished=True,
        raw_text=display_raw,
        full_session_polish=True,
        transcript_stats=stop_stats,
    )
    return stats


async def _mark_live_polish_pending(session_id: str) -> None:
    count = _polish_pending.get(session_id, 0) + 1
    _polish_pending[session_id] = count
    if count == 1:
        await _emit_live_status(
            session_id,
            "live_polish_pending",
            payload={"live_phase": "polish"},
        )


async def _mark_live_polish_done(session_id: str) -> None:
    count = max(0, _polish_pending.get(session_id, 0) - 1)
    if count == 0:
        _polish_pending.pop(session_id, None)
        await _emit_live_status(
            session_id,
            "live_polish_done",
            payload={"live_phase": "idle"},
        )
    else:
        _polish_pending[session_id] = count


def _schedule_live_polish(session_id: str, segment_key: int, raw_text: str, source: str) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("live_meeting polish_schedule_no_loop id=%s", session_id)
        return
    task = loop.create_task(_run_live_polish(session_id, segment_key, raw_text, source))
    _track_asr_task(session_id, task)


async def _run_live_polish(session_id: str, segment_key: int, raw_text: str, source: str) -> None:
    await _mark_live_polish_pending(session_id)
    try:
        runtime = _runtime.get(session_id)
        if not _live_polish_enabled(runtime):
            await _finalize_live_segment_carry(session_id, raw_text)
            return
        assert runtime is not None
        try:
            async with httpx.AsyncClient() as client:
                polished, perr = await polish_transcript(
                    client,
                    raw_text=raw_text,
                    polish_cfg=_polish_cfg_for_runtime(runtime),
                    glossary=runtime.glossary,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "live_meeting polish_failed id=%s seg=%s err=%s",
                session_id,
                segment_key,
                exc,
            )
            await _finalize_live_segment_carry(session_id, raw_text)
            return
        if perr:
            logger.info(
                "live_meeting polish_skip id=%s seg=%s err=%s",
                session_id,
                segment_key,
                perr,
            )
            await _finalize_live_segment_carry(session_id, raw_text)
            return
        if not polished or polished.strip() == raw_text.strip():
            await _finalize_live_segment_carry(session_id, raw_text)
            return
        raw_len = len(raw_text.strip())
        pol_len = len(polished.strip())
        if raw_len >= 24 and pol_len < raw_len * 0.55:
            logger.warning(
                "live_meeting polish_truncated id=%s seg=%s raw_chars=%s pol_chars=%s",
                session_id,
                segment_key,
                raw_len,
                pol_len,
            )
            await _finalize_live_segment_carry(session_id, raw_text)
            await _emit_live_transcript(
                session_id,
                raw_text,
                is_final=True,
                source=f"{source}_polish_keep_raw",
                segment=segment_key,
                skip_polish=True,
                polished=True,
                raw_text=raw_text,
            )
            return
        await _emit_live_transcript(
            session_id,
            polished,
            is_final=True,
            source=f"{source}_polish",
            segment=segment_key,
            skip_polish=True,
            polished=True,
            raw_text=raw_text,
        )
    finally:
        await _mark_live_polish_done(session_id)


async def _emit_live_transcript(
    session_id: str,
    text: str,
    *,
    is_final: bool,
    source: str = "live_stream",
    segment: int | None = None,
    skip_polish: bool = False,
    polished: bool = False,
    raw_text: str | None = None,
    full_session_polish: bool = False,
    transcript_stats: dict[str, Any] | None = None,
) -> None:
    session = get_session(session_id)
    if session is None:
        return
    text = sanitize_asr_transcript_text(text)
    if not text:
        return
    runtime = _runtime.get(session_id)
    if runtime is not None:
        if _is_batch_asr_source(source):
            if is_final and segment is not None:
                batch_text = text
                if polished and raw_text:
                    batch_text = str(raw_text).strip() or text
                _note_batch_asr_segment(runtime, int(segment), batch_text)
        elif _is_live_asr_source(source):
            _note_live_transcript_memory(runtime, text)
    hub = get_live_stream(session_id)
    seg = _partial_seq.get(session_id, 0)
    if is_final and segment is not None:
        seg_key = segment
        _partial_seq[session_id] = max(seg, segment)
    elif is_final:
        _partial_seq[session_id] = seg + 1
        seg_key = seg + 1
    else:
        seg_key = -(seg + 1)

    ts = int(time.time())
    payload: dict[str, Any] = {
        "is_final": is_final,
        "segment": seg_key,
        "ts": ts,
        "source": source,
        "asr_track": "batch" if _is_batch_asr_source(source) else "live",
    }
    if polished:
        payload["polished"] = True
    if raw_text:
        payload["raw_text"] = raw_text
    if full_session_polish:
        payload["full_session_polish"] = True
    if transcript_stats:
        payload["transcript_stats"] = transcript_stats

    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_TRANSCRIPT,
            text=text,
            payload=payload,
        )
    )

    if not is_final:
        return

    record: dict[str, Any] = {
        "segment": seg_key,
        "text": text,
        "is_final": True,
        "ts": ts,
        "source": source,
    }
    if polished:
        record["polished"] = True
        if raw_text:
            record["raw_text"] = raw_text
    _append_transcript_line(session, record)

    if (
        polished
        or skip_polish
        or not _live_polish_enabled(_runtime.get(session_id))
        or not _live_segment_polish_enabled()
    ):
        await _finalize_live_segment_carry(session_id, text, raw_text=raw_text)
    elif len(text.strip()) >= 2:
        _schedule_live_polish(session_id, seg_key, text, source)
    else:
        await _finalize_live_segment_carry(session_id, text, raw_text=raw_text)


async def _emit_live_status(
    session_id: str, text: str, *, payload: dict[str, Any] | None = None
) -> None:
    hub = get_live_stream(session_id)
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind="status",
            text=text,
            payload=payload or {},
        )
    )


async def _release_stream_bridge(session_id: str, reason: str) -> None:
    _bridge_emit_at.pop(session_id, None)
    silent_task = _stream_silent_tasks.pop(session_id, None)
    if silent_task is not None:
        silent_task.cancel()
    bridge = _bridges.pop(session_id, None)
    if bridge is not None:
        try:
            await bridge.close()
        except Exception:  # noqa: BLE001
            pass
    hub = get_live_stream(session_id)
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_ERROR,
            text=f"live_stream_failed:{reason[:160]}",
        )
    )
    await _emit_live_status(
        session_id,
        "stream_bridge_down",
        payload={"reason": reason[:160]},
    )


async def _ensure_stream_bridge(session_id: str) -> None:
    if session_id in _bridges:
        return
    runtime = _runtime.get(session_id)
    if runtime is None:
        logger.warning("live_meeting stream_bridge_skip id=%s reason=no_runtime", session_id)
        return
    cfg = runtime.asr_cfg if isinstance(runtime.asr_cfg, dict) else {}
    ws_url = resolve_live_stream_ws_url(cfg)
    driver = resolve_stream_driver(cfg)
    if not driver:
        logger.info(
            "live_meeting stream_bridge_skip id=%s mode=%s ws_url=%s stream_protocol=%s provider=%s",
            session_id,
            cfg.get("mode"),
            ws_url or "(none)",
            cfg.get("stream_protocol") or cfg.get("live_stream_protocol") or "(auto)",
            cfg.get("provider"),
        )
        await _emit_live_status(
            session_id,
            "stream_bridge_skip",
            payload={
                "mode": cfg.get("mode"),
                "ws_url": ws_url or None,
                "stream_protocol": cfg.get("stream_protocol"),
                "provider": cfg.get("provider"),
            },
        )
        return
    if driver == "dashscope" and not dashscope_api_key(runtime.asr_cfg or {}):
        hub = get_live_stream(session_id)
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text="dashscope_api_key_missing",
            )
        )
        return

    stream_source = f"{driver}_stream"

    async def _watch_stream_silent(sid: str) -> None:
        try:
            await asyncio.sleep(STREAM_SILENT_TIMEOUT_SEC)
            if sid not in _bridges or sid in _bridge_emit_at:
                return
            logger.warning("live_meeting stream_silent_timeout id=%s", sid)
            await _release_stream_bridge(sid, "stream_no_transcript_timeout")
        except asyncio.CancelledError:
            return

    async def _on_emit(t: str, is_final: bool) -> None:
        _bridge_emit_at[session_id] = time.monotonic()
        silent = _stream_silent_tasks.pop(session_id, None)
        if silent is not None:
            silent.cancel()
        await _emit_live_transcript(session_id, t, is_final=is_final, source=stream_source)

    async def _on_fatal(reason: str) -> None:
        await _release_stream_bridge(session_id, reason)

    try:
        bridge = await create_and_start_live_stream_bridge(
            session_id=session_id,
            asr_cfg=runtime.asr_cfg or {},
            on_emit=_on_emit,
            glossary=runtime.glossary,
            on_fatal=_on_fatal,
        )
        _bridges[session_id] = bridge
        _stream_silent_tasks[session_id] = asyncio.create_task(_watch_stream_silent(session_id))
        logger.info(
            "live_meeting stream_bridge_ready id=%s driver=%s upstream=%s",
            session_id,
            driver,
            ws_url[:120] if ws_url else "(none)",
        )
        await _emit_live_status(
            session_id,
            "stream_bridge_ready",
            payload={"driver": driver, "upstream_ws": ws_url or None},
        )
    except Exception as e:
        logger.exception(
            "live_meeting stream_bridge_failed id=%s driver=%s upstream=%s",
            session_id,
            driver,
            ws_url,
        )
        await _release_stream_bridge(session_id, f"{driver}:{str(e)[:100]}")


async def _ensure_dashscope_bridge(session_id: str) -> None:
    """Backward-compatible alias."""
    await _ensure_stream_bridge(session_id)


async def _process_closed_segment(session_id: str, pcm_path: Path, segment_index: int) -> None:
    """Batch ASR for one closed ~5 s PCM segment — runs in parallel with live streaming."""
    runtime = _runtime.get(session_id)
    session = get_session(session_id)
    if session is None or runtime is None:
        return

    seg_asr_cfg = segment_transcribe_asr_cfg(runtime.asr_cfg, runtime.asr_fallback_cfg)
    if not isinstance(seg_asr_cfg, dict) or not has_batch_transcribe_config(seg_asr_cfg):
        return

    hub = get_live_stream(session_id)
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind="status",
            text=f"transcribing_segment_{segment_index}",
            payload={"segment": segment_index, "asr_track": "batch"},
        )
    )

    text, err = await transcribe_live_pcm_segment(
        pcm_path=pcm_path,
        asr_cfg=seg_asr_cfg,
        glossary=runtime.glossary,
    )
    if (  # noqa: SIM102
        (err or not text)
        and isinstance(runtime.asr_fallback_cfg, dict)
        and runtime.asr_fallback_cfg
    ):
        if seg_asr_cfg is not runtime.asr_fallback_cfg:
            logger.info(
                "live_meeting asr_fallback id=%s seg=%s primary_err=%s",
                session_id,
                segment_index,
                err,
            )
            text, err = await transcribe_live_pcm_segment(
                pcm_path=pcm_path,
                asr_cfg=runtime.asr_fallback_cfg,
                glossary=runtime.glossary,
            )
    if err or not text:
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text=err or "asr_empty_transcript",
                payload={"segment": segment_index},
            )
        )
        logger.warning(
            "live_meeting segment_asr_failed id=%s seg=%s err=%s",
            session_id,
            segment_index,
            err,
        )
        return

    await _emit_live_transcript(
        session_id,
        text,
        is_final=True,
        source="batch_segment",
        segment=segment_index,
    )
    logger.info(
        "live_meeting segment_transcribed id=%s seg=%s chars=%s provider=%s batch_protocol=%s",
        session_id,
        segment_index,
        len(text),
        (seg_asr_cfg or {}).get("provider"),
        (seg_asr_cfg or {}).get("batch_protocol") or "openai_compat",
    )


async def _maybe_emit_bubbles(session_id: str, *, force: bool = False) -> None:
    runtime = _runtime.get(session_id)
    if runtime is None:
        return
    now = time.time()
    interval = cadence_interval_sec(runtime.session.cadence)
    last = _last_bubble_emit.get(session_id, 0.0)
    if not force and now - last < interval:
        return
    text = (runtime.carry_prompt or "").strip()
    if len(text) < 8:
        return
    bubbles = extract_bubbles(text, runtime.glossary)
    if not bubbles:
        return
    _last_bubble_emit[session_id] = now
    hub = get_live_stream(session_id)
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_PHASE,
            text="extracting",
            payload={"live_phase": "thinking"},
        )
    )
    for bubble in bubbles:
        label = str(bubble.get("text") or "").strip()
        if not label:
            continue
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_LIVE_BUBBLE,
                text=label,
                payload=bubble,
            )
        )
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_PHASE,
            text="idle",
            payload={"live_phase": "idle"},
        )
    )
    logger.info(
        "live_meeting bubbles_emitted id=%s count=%s cadence=%s",
        session_id,
        len(bubbles),
        runtime.session.cadence,
    )


async def _run_bubble_lookup(session_id: str, query: str, bubble_id: str) -> None:
    runtime = _runtime.get(session_id)
    if runtime is None:
        return
    hub = get_live_stream(session_id)
    label = (query or "").strip()
    if not label:
        return
    profiles = runtime.vault_retrieval_profiles
    if not profiles:
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text="vault_rag_not_configured",
                payload={"bubble_id": bubble_id},
            )
        )
        return

    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_PHASE,
            text="rag",
            payload={"live_phase": "rag", "bubble_id": bubble_id},
        )
    )
    try:
        result = await lookup_bubble_vault(
            label,
            vault_retrieval_profiles=profiles,
            embedding=runtime.embedding,
            vault_rag=runtime.vault_rag_config,
            vault_auto_rag=True,
        )
    except Exception as e:
        logger.exception("live_meeting bubble_rag_failed id=%s", session_id)
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text=f"bubble_rag_failed:{str(e)[:120]}",
                payload={"bubble_id": bubble_id},
            )
        )
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_LIVE_PHASE,
                text="idle",
                payload={"live_phase": "idle"},
            )
        )
        return

    materials = result.get("materials") if isinstance(result.get("materials"), list) else []
    passage_count = int(result.get("passage_count") or 0)
    stats_payload = _live_stats_payload(
        bubble_id=bubble_id,
        evidence_total=len(materials),
        passage_count=passage_count,
        runtime=runtime,
    )
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_STATS,
            text=label,
            payload=stats_payload,
        )
    )
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_MATERIALS,
            text=label,
            payload={
                "bubble_id": bubble_id,
                "query": label,
                "passage_count": int(result.get("passage_count") or 0),
                "materials": materials,
                "activity_lines": result.get("activity_lines")
                if isinstance(result.get("activity_lines"), list)
                else [],
            },
        )
    )
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_PHASE,
            text="idle",
            payload={"live_phase": "idle", "bubble_id": bubble_id},
        )
    )
    logger.info(
        "live_meeting bubble_rag_done id=%s bubble=%s hits=%s materials=%s",
        session_id,
        bubble_id,
        result.get("passage_count"),
        len(materials),
    )


def _on_segment_closed(session_id: str, pcm_path: Path, segment_index: int) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("live_meeting segment_closed without event loop id=%s", session_id)
        return
    task = loop.create_task(_process_closed_segment(session_id, pcm_path, segment_index))
    _track_asr_task(session_id, task)


def _writer_for(session: LiveMeetingSession) -> SegmentWriter:
    sid = session.session_id

    def _closed(path: Path, index: int) -> None:
        _on_segment_closed(sid, path, index)

    return SegmentWriter(session.audio_dir, on_segment_closed=_closed)


async def stop_session(
    session_id: str,
    *,
    keep_audio: bool,
    client_live_text: str | None = None,
    client_live_chunks: list[str] | None = None,
    client_batch_chunks: list[str] | None = None,
) -> dict[str, Any]:
    session = get_session(session_id)
    if session is None:
        return {"ok": False, "reason": "unknown_session"}
    runtime = _runtime.get(session_id)
    polish_configured = _live_polish_enabled(runtime)
    bridge = _bridges.pop(session_id, None)
    _bridge_emit_at.pop(session_id, None)
    silent_task = _stream_silent_tasks.pop(session_id, None)
    if silent_task is not None:
        silent_task.cancel()
    if bridge is not None:
        await bridge.close()
    _partial_seq.pop(session_id, None)
    _last_bubble_emit.pop(session_id, None)
    writer = _writers.pop(session_id, None)
    if writer is not None:
        writer.close()
    asr_drain_sec = float(os.environ.get("OAAO_LIVE_STOP_ASR_DRAIN_SEC", "1.5"))
    pending = list(_asr_tasks.get(session_id, set()))
    if pending:
        results = await asyncio.gather(
            *[
                asyncio.wait_for(t, timeout=asr_drain_sec)
                for t in pending
                if not t.done()
            ],
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception) and not isinstance(result, asyncio.TimeoutError):
                logger.warning("live_meeting asr_task_error id=%s err=%s", session_id, result)
        for task in pending:
            if not task.done():
                task.cancel()
    _asr_tasks.pop(session_id, None)
    polish_pending = int(_polish_pending.get(session_id, 0))
    transcript_stats: dict[str, Any] = {}
    if runtime is not None and session is not None:
        transcript_stats = await _maybe_full_session_polish_on_stop(
            session_id,
            session,
            runtime,
            client_live_text=client_live_text,
            client_live_chunks=client_live_chunks,
            client_batch_chunks=client_batch_chunks,
        )
    if polish_pending == 0 and polish_configured:
        await _emit_live_status(
            session_id,
            "live_polish_done",
            payload={"live_phase": "idle", "source": "session_stop"},
        )
    _polish_pending.pop(session_id, None)
    _runtime.pop(session_id, None)
    _stream_tokens.revoke(session_id)
    session.mark_stopped(keep_audio=keep_audio)
    if not keep_audio:
        import shutil

        try:
            shutil.rmtree(session.session_dir, ignore_errors=True)
        except OSError:
            logger.warning("live_meeting cleanup_failed id=%s", session_id)
    _active.pop(session_id, None)
    drop_live_stream(session_id)
    logger.info(
        "live_meeting session_stopped id=%s keep_audio=%s polish_configured=%s",
        session_id,
        keep_audio,
        polish_configured,
    )
    return {
        "ok": True,
        "session_id": session_id,
        "keep_audio": keep_audio,
        "polish_configured": polish_configured,
        "polish_pending_resolved": polish_pending == 0,
        "transcript_stats": transcript_stats,
    }


async def handle_audio_websocket(
    websocket: WebSocket,
    session_id: str,
    *,
    token: str = "",
) -> None:
    """Binary PCM frames (s16le mono 16 kHz) or JSON ``{ \"type\": \"ping\" }`` heartbeat.

    Auth modes (hybrid, W10-S2 + W10-S3):

    * **Query-token (W10-S2, legacy):** ``?token=<hex>`` in the WS URL. Validated
      *before* :py:meth:`WebSocket.accept`. Subject to proxy/access-log leakage.
    * **First-frame (W10-S3, preferred):** open WS with no query token, then the
      client MUST send a single JSON text frame ``{"type": "auth", "token": "<hex>"}``
      within 3 seconds of the accept. Token never appears in URL → never in
      reverse-proxy access logs.

    Either mode succeeds — clients may upgrade incrementally.
    """
    sid = (session_id or "").strip()
    pre_authed = False
    if token:
        # W10-S2 path: validate before accept; reject unknown tokens silently (4401).
        if not validate_stream_token(sid, token):
            await websocket.close(code=4401)
            return
        pre_authed = True

    session = get_session(sid)
    if session is None or session.status != "active":
        await websocket.close(code=4404)
        return

    await websocket.accept()

    if not pre_authed:  # noqa: SIM102
        if not await _await_first_frame_auth(websocket, sid):
            return

    await _ensure_stream_bridge(sid)
    rt = _runtime.get(sid)
    cfg = rt.asr_cfg if rt and isinstance(rt.asr_cfg, dict) else {}
    logger.info(
        "live_meeting ws_open id=%s bridge_active=%s upstream=%s driver=%s",
        sid,
        sid in _bridges,
        resolve_live_stream_ws_url(cfg) or "(none)",
        resolve_stream_driver(cfg) or "(none)",
    )
    writer = _writers.get(sid)
    if writer is None:
        writer = _writer_for(session)
        _writers[sid] = writer

    frames = 0
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw:
                pcm = bytes(raw)
                writer.write_pcm(pcm)
                bridge = _bridges.get(sid)
                if bridge is not None:
                    await bridge.push_pcm(pcm)
                frames += 1
                continue
            text = message.get("text")
            if text:
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and payload.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                    continue
                if isinstance(payload, dict) and payload.get("type") == "bubble_request":
                    await _maybe_emit_bubbles(sid, force=True)
                    await websocket.send_text(json.dumps({"type": "bubble_ack"}))
                    continue
                if isinstance(payload, dict) and payload.get("type") == "bubble_lookup":
                    text = str(payload.get("text") or "").strip()
                    bubble_id = str(payload.get("bubble_id") or "").strip()
                    if text:
                        task = asyncio.create_task(_run_bubble_lookup(sid, text, bubble_id))
                        _track_asr_task(sid, task)
                    await websocket.send_text(json.dumps({"type": "bubble_lookup_ack"}))
    except WebSocketDisconnect:
        pass
    finally:
        logger.info(
            "live_meeting ws_closed id=%s frames=%s total_bytes=%s",
            sid,
            frames,
            writer.total_bytes,
        )


async def subscribe_live_stream(session_id: str, *, since_seq: int = 0):
    """Async iterator of SSE chunks for ``GET /v1/live/{id}/stream``."""
    session = get_session(session_id)
    if session is None:
        return
    hub = get_live_stream(session_id)
    async for chunk in hub.subscribe(since_seq):
        yield chunk


def public_urls(session_id: str, *, public_base: str) -> dict[str, str]:
    base = (public_base or "").rstrip("/")
    token = _stream_tokens.mint(session_id, nbytes=16)
    return {
        "ws_audio_url": f"/v1/live/{session_id}/audio?token={token}",
        "stream_url": f"{base}/v1/live/{session_id}/stream",
        "stream_token": token,
    }


def validate_stream_token(session_id: str, token: str) -> bool:
    """Constant-time check for live stream / WS token."""
    sid = (session_id or "").strip()
    supplied = (token or "").strip()
    if not sid or not supplied:
        return False
    return _stream_tokens.validate(sid, supplied)


async def _await_first_frame_auth(
    websocket: WebSocket,
    session_id: str,
    *,
    timeout: float = 3.0,
) -> bool:
    """W10-S3 — consume the first WS text frame and validate `{type:"auth", token}`.

    Returns ``True`` on success (caller proceeds to PCM loop). On any failure
    the socket is closed with code ``4401`` and the function returns ``False``.
    Closes are silent (no extra payload) to avoid leaking session-existence /
    token-format details to an unauthenticated peer.
    """
    try:
        first = await asyncio.wait_for(websocket.receive(), timeout=timeout)
    except TimeoutError:
        logger.info("live_meeting ws_auth_timeout id=%s", session_id)
        await websocket.close(code=4401)
        return False
    if first.get("type") == "websocket.disconnect":
        return False
    text_payload = first.get("text") or ""
    if not text_payload:
        await websocket.close(code=4401)
        return False
    try:
        auth_msg = json.loads(text_payload)
    except json.JSONDecodeError:
        await websocket.close(code=4401)
        return False
    if not isinstance(auth_msg, dict) or auth_msg.get("type") != "auth":
        await websocket.close(code=4401)
        return False
    supplied = str(auth_msg.get("token") or "")
    if not validate_stream_token(session_id, supplied):
        logger.info("live_meeting ws_auth_bad_token id=%s", session_id)
        await websocket.close(code=4401)
        return False
    return True


def session_start_payload(
    *,
    cadence: str,
    retention_mode: str,
    workspace_id: int | None,
    user_id: int | None,
    public_base: str,
    asr_cfg: dict[str, Any] | None = None,
    asr_fallback_cfg: dict[str, Any] | None = None,
    polish_cfg: dict[str, Any] | None = None,
    locale: str | None = None,
    polish_style: str | None = None,
    glossary: dict[str, Any] | None = None,
    vault_retrieval_profiles: list[dict[str, Any]] | None = None,
    embedding: dict[str, Any] | None = None,
    vault_rag_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session = create_session(
        cadence=cadence,
        retention_mode=retention_mode,
        workspace_id=workspace_id,
        user_id=user_id,
        asr_cfg=asr_cfg,
        asr_fallback_cfg=asr_fallback_cfg,
        polish_cfg=polish_cfg,
        locale=locale,
        polish_style=polish_style,
        glossary=glossary,
        vault_retrieval_profiles=vault_retrieval_profiles,
        embedding=embedding,
        vault_rag_config=vault_rag_config,
    )
    urls = public_urls(session.session_id, public_base=public_base)
    out: dict[str, Any] = {
        "session_id": session.session_id,
        **urls,
    }
    if asr_cfg:
        out["asr_configured"] = True
    seg_cfg = segment_transcribe_asr_cfg(asr_cfg, asr_fallback_cfg)
    driver = resolve_stream_driver(asr_cfg if isinstance(asr_cfg, dict) else None)
    out["live_stream_configured"] = bool(driver)
    out["batch_asr_configured"] = isinstance(seg_cfg, dict) and has_batch_transcribe_config(seg_cfg)
    if polish_cfg:
        out["polish_configured"] = True
        out["polish_style"] = normalize_polish_style(polish_style)
    out["locale"] = _normalize_session_locale(locale)
    out["quick_punctuate_rules"] = load_quick_punctuate_rules()
    if vault_retrieval_profiles:
        out["vault_rag_configured"] = True
    return out
