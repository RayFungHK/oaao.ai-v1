"""In-memory session registry — WS audio ingest, segment ASR, SSE broadcast."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from oaao_orchestrator.live_meeting.audio_store import SegmentWriter
from oaao_orchestrator.live_meeting.bubble_engine import (
    cadence_interval_sec,
    extract_bubbles,
)
from oaao_orchestrator.live_meeting.bubble_rag import lookup_bubble_vault
from oaao_orchestrator.live_meeting.dashscope_asr_stream import (
    DashscopeRealtimeAsrBridge,
    create_and_start_bridge,
    dashscope_api_key,
)
from oaao_orchestrator.live_meeting.qwen_asr_stream import (
    transcribe_live_pcm_segment,
    use_dashscope_realtime_stream,
)
from oaao_orchestrator.live_meeting.session import LiveMeetingSession, live_meeting_root, new_session_id
from oaao_orchestrator.live_meeting.sse_hub import drop_live_stream, get_live_stream
from oaao_orchestrator.streaming.events import (
    KIND_ERROR,
    KIND_LIVE_BUBBLE,
    KIND_LIVE_MATERIALS,
    KIND_LIVE_PHASE,
    KIND_LIVE_TRANSCRIPT,
    PHASE_LIVE,
    StreamEnvelope,
)

logger = logging.getLogger(__name__)

_active: dict[str, LiveMeetingSession] = {}
_writers: dict[str, SegmentWriter] = {}
_asr_tasks: dict[str, set[asyncio.Task[Any]]] = {}
_bridges: dict[str, DashscopeRealtimeAsrBridge] = {}
_partial_seq: dict[str, int] = {}
_last_bubble_emit: dict[str, float] = {}


@dataclass
class _SessionRuntime:
    session: LiveMeetingSession
    asr_cfg: dict[str, Any] | None
    glossary: dict[str, Any] | None
    vault_retrieval_profiles: list[dict[str, Any]] | None = None
    embedding: dict[str, Any] | None = None
    vault_rag_config: dict[str, Any] | None = None
    carry_prompt: str = ""


_runtime: dict[str, _SessionRuntime] = {}


def create_session(
    *,
    cadence: str = "1v1",
    retention_mode: str = "disk_ttl",
    workspace_id: int | None = None,
    user_id: int | None = None,
    asr_cfg: dict[str, Any] | None = None,
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
        vault_retrieval_profiles=profiles or None,
        embedding=embedding if isinstance(embedding, dict) else None,
        vault_rag_config=vault_rag_config if isinstance(vault_rag_config, dict) else None,
    )
    get_live_stream(session.session_id)
    if use_dashscope_realtime_stream(asr_cfg):
        logger.info(
            "live_meeting dashscope streaming ASR id=%s model=%s",
            session.session_id,
            (asr_cfg or {}).get("model"),
        )
    logger.info("live_meeting session_created id=%s workspace_id=%s", session.session_id, workspace_id)
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


async def _emit_live_transcript(session_id: str, text: str, *, is_final: bool) -> None:
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
            {"segment": seg_key, "text": text, "is_final": True, "ts": ts, "source": "dashscope_stream"},
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
            payload={"is_final": is_final, "segment": seg_key, "ts": ts, "source": "dashscope_stream"},
        )
    )


async def _ensure_dashscope_bridge(session_id: str) -> None:
    if session_id in _bridges:
        return
    runtime = _runtime.get(session_id)
    if runtime is None or not use_dashscope_realtime_stream(runtime.asr_cfg):
        return
    if not dashscope_api_key(runtime.asr_cfg or {}):
        hub = get_live_stream(session_id)
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text="dashscope_api_key_missing",
            )
        )
        return

    async def _on_emit(t: str, is_final: bool) -> None:
        await _emit_live_transcript(session_id, t, is_final=is_final)

    try:
        bridge = await create_and_start_bridge(
            session_id=session_id,
            asr_cfg=runtime.asr_cfg or {},
            on_emit=_on_emit,
            glossary=runtime.glossary,
        )
        _bridges[session_id] = bridge
    except Exception as e:  # noqa: BLE001
        logger.exception("live_meeting dashscope_bridge_failed id=%s", session_id)
        hub = get_live_stream(session_id)
        await hub.append(
            StreamEnvelope(
                phase=PHASE_LIVE,
                kind=KIND_ERROR,
                text=f"dashscope_stream_failed:{str(e)[:120]}",
            )
        )


async def _process_closed_segment(session_id: str, pcm_path: Path, segment_index: int) -> None:
    if session_id in _bridges:
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

    text, err = await transcribe_live_pcm_segment(
        pcm_path=pcm_path,
        asr_cfg=runtime.asr_cfg,
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
            payload={"is_final": True, "segment": segment_index, "ts": ts},
        )
    )
    logger.info(
        "live_meeting segment_transcribed id=%s seg=%s chars=%s",
        session_id,
        segment_index,
        len(text),
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
    except Exception as e:  # noqa: BLE001
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
                "activity_lines": result.get("activity_lines") if isinstance(result.get("activity_lines"), list) else [],
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
    if bridge is not None:
        await bridge.close()
    _partial_seq.pop(session_id, None)
    _last_bubble_emit.pop(session_id, None)
    writer = _writers.pop(session_id, None)
    if writer is not None:
        writer.close()
    for task in list(_asr_tasks.pop(session_id, set())):
        if not task.done():
            task.cancel()
    _runtime.pop(session_id, None)
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


async def handle_audio_websocket(websocket: WebSocket, session_id: str) -> None:
    """Binary PCM frames (s16le mono 16 kHz) or JSON ``{ \"type\": \"ping\" }`` heartbeat."""
    sid = (session_id or "").strip()
    session = get_session(sid)
    if session is None or session.status != "active":
        await websocket.close(code=4404)
        return

    await websocket.accept()
    await _ensure_dashscope_bridge(sid)
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
    return {
        "ws_audio_url": f"/v1/live/{session_id}/audio",
        "stream_url": f"{base}/v1/live/{session_id}/stream",
        "stream_token": token,
    }


def session_start_payload(
    *,
    cadence: str,
    retention_mode: str,
    workspace_id: int | None,
    user_id: int | None,
    public_base: str,
    asr_cfg: dict[str, Any] | None = None,
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
