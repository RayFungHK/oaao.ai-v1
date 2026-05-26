"""In-memory session registry — WS audio ingest, streaming ASR bridge, SSE broadcast.

When a duplex streaming bridge is active, closed ~5 s PCM segments are kept on disk but
not batch-transcribed. Segment ``POST /transcribe`` is the fallback when no stream bridge
is connected. Drivers: ``stream_bridge.resolve_stream_driver`` (``dashscope``, ``funasr_runtime``, …).
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from oaao_orchestrator.live_meeting.audio_store import SegmentWriter
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

logger = logging.getLogger(__name__)

_active: dict[str, LiveMeetingSession] = {}
_writers: dict[str, SegmentWriter] = {}
_asr_tasks: dict[str, set[asyncio.Task[Any]]] = {}
_bridges: dict[str, LiveStreamAsrBridge] = {}
_bridge_emit_at: dict[str, float] = {}
_stream_silent_tasks: dict[str, asyncio.Task[Any]] = {}
_partial_seq: dict[str, int] = {}
_last_bubble_emit: dict[str, float] = {}
# W10-S1: minted stream tokens for GET /v1/live/{id}/stream — validated with secrets.compare_digest.
_stream_tokens: dict[str, str] = {}

STREAM_SILENT_TIMEOUT_SEC = 12.0


@dataclass
class _SessionRuntime:
    session: LiveMeetingSession
    asr_cfg: dict[str, Any] | None
    glossary: dict[str, Any] | None
    asr_fallback_cfg: dict[str, Any] | None = None
    vault_retrieval_profiles: list[dict[str, Any]] | None = None
    embedding: dict[str, Any] | None = None
    vault_rag_config: dict[str, Any] | None = None
    carry_prompt: str = ""
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


def create_session(
    *,
    cadence: str = "1v1",
    retention_mode: str = "disk_ttl",
    workspace_id: int | None = None,
    user_id: int | None = None,
    asr_cfg: dict[str, Any] | None = None,
    asr_fallback_cfg: dict[str, Any] | None = None,
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


async def _emit_live_transcript(
    session_id: str,
    text: str,
    *,
    is_final: bool,
    source: str = "live_stream",
) -> None:
    session = get_session(session_id)
    if session is None:
        return
    hub = get_live_stream(session_id)
    seg = _partial_seq.get(session_id, 0)
    if is_final:
        _partial_seq[session_id] = seg + 1
        seg_key = seg + 1
    else:
        seg_key = -(seg + 1)

    ts = int(time.time())
    if is_final:
        _append_transcript_line(
            session,
            {"segment": seg_key, "text": text, "is_final": True, "ts": ts, "source": source},
        )
        runtime = _runtime.get(session_id)
        if runtime is not None and text.strip():
            if runtime.carry_prompt:
                runtime.carry_prompt = f"{runtime.carry_prompt}\n{text}"[-800:]
            else:
                runtime.carry_prompt = text[:800]
            await _maybe_emit_bubbles(session_id)

    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_TRANSCRIPT,
            text=text,
            payload={"is_final": is_final, "segment": seg_key, "ts": ts, "source": source},
        )
    )


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
    # Skip batch only when the stream bridge has actually emitted transcript text.
    if session_id in _bridges and session_id in _bridge_emit_at:
        return
    runtime = _runtime.get(session_id)
    session = get_session(session_id)
    if session is None or runtime is None:
        return

    hub = get_live_stream(session_id)
    if not runtime.asr_cfg:
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text="asr_not_configured",
                payload={"segment": segment_index},
            )
        )
        return

    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind="status",
            text=f"transcribing_segment_{segment_index}",
            payload={"segment": segment_index},
        )
    )

    seg_asr_cfg = segment_transcribe_asr_cfg(runtime.asr_cfg, runtime.asr_fallback_cfg)
    text, err = await transcribe_live_pcm_segment(
        pcm_path=pcm_path,
        asr_cfg=seg_asr_cfg or runtime.asr_cfg or {},
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

    ts = int(time.time())
    _append_transcript_line(
        session,
        {
            "segment": segment_index,
            "text": text,
            "is_final": True,
            "ts": ts,
        },
    )
    if runtime.carry_prompt:
        runtime.carry_prompt = f"{runtime.carry_prompt}\n{text}"[-800:]
    else:
        runtime.carry_prompt = text[:800]

    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_TRANSCRIPT,
            text=text,
            payload={
                "is_final": True,
                "segment": segment_index,
                "ts": ts,
                "source": "batch_segment",
            },
        )
    )
    logger.info(
        "live_meeting segment_transcribed id=%s seg=%s chars=%s provider=%s batch_protocol=%s",
        session_id,
        segment_index,
        len(text),
        (seg_asr_cfg or {}).get("provider"),
        (seg_asr_cfg or {}).get("batch_protocol") or "openai_compat",
    )
    await _maybe_emit_bubbles(session_id)


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


async def stop_session(session_id: str, *, keep_audio: bool) -> bool:
    session = get_session(session_id)
    if session is None:
        return False
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
    pending = list(_asr_tasks.get(session_id, set()))
    if pending:
        results = await asyncio.gather(
            *[asyncio.wait_for(t, timeout=45.0) for t in pending if not t.done()],
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception) and not isinstance(result, asyncio.TimeoutError):
                logger.warning("live_meeting asr_task_error id=%s err=%s", session_id, result)
    _asr_tasks.pop(session_id, None)
    _runtime.pop(session_id, None)
    _stream_tokens.pop(session_id, None)
    drop_live_stream(session_id)
    session.mark_stopped(keep_audio=keep_audio)
    if not keep_audio:
        import shutil

        try:
            shutil.rmtree(session.session_dir, ignore_errors=True)
        except OSError:
            logger.warning("live_meeting cleanup_failed id=%s", session_id)
    _active.pop(session_id, None)
    logger.info("live_meeting session_stopped id=%s keep_audio=%s", session_id, keep_audio)
    return True


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
    token = secrets.token_hex(16)
    # W10-S1: persist token so the SSE endpoint can validate the caller.
    # W10-S2: same token gates the WS audio uplink (passed via ?token= query).
    _stream_tokens[session_id] = token
    return {
        "ws_audio_url": f"/v1/live/{session_id}/audio?token={token}",
        "stream_url": f"{base}/v1/live/{session_id}/stream",
        "stream_token": token,
    }


def validate_stream_token(session_id: str, token: str) -> bool:
    """Constant-time check for ``GET /v1/live/{session_id}/stream`` token query.

    Returns ``True`` only when a token has been minted for ``session_id`` via
    :func:`public_urls` and the supplied ``token`` matches exactly.
    """
    sid = (session_id or "").strip()
    supplied = (token or "").strip()
    if not sid or not supplied:
        return False
    expected = _stream_tokens.get(sid)
    if not expected:
        return False
    return secrets.compare_digest(expected, supplied)


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
    if vault_retrieval_profiles:
        out["vault_rag_configured"] = True
    return out
