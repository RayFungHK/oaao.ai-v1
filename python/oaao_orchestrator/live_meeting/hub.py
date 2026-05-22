"""In-memory session registry — M1 stub before Qwen ASR bridge (Phase C)."""

from __future__ import annotations

import logging
import secrets
from typing import Any

from oaao_orchestrator.live_meeting.session import LiveMeetingSession, live_meeting_root, new_session_id

logger = logging.getLogger(__name__)

_active: dict[str, LiveMeetingSession] = {}


def create_session(
    *,
    cadence: str = "1v1",
    retention_mode: str = "disk_ttl",
    workspace_id: int | None = None,
    user_id: int | None = None,
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
    )
    session.ensure_dirs()
    session.write_meta()
    _active[session.session_id] = session
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


def stop_session(session_id: str, *, keep_audio: bool) -> bool:
    session = get_session(session_id)
    if session is None:
        return False
    session.mark_stopped(keep_audio=keep_audio)
    _active.pop(session_id, None)
    logger.info("live_meeting session_stopped id=%s keep_audio=%s", session_id, keep_audio)
    return True


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
) -> dict[str, Any]:
    session = create_session(
        cadence=cadence,
        retention_mode=retention_mode,
        workspace_id=workspace_id,
        user_id=user_id,
    )
    urls = public_urls(session.session_id, public_base=public_base)
    return {
        "session_id": session.session_id,
        **urls,
    }
