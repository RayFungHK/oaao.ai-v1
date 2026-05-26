"""W10-S1 — Live meeting SSE stream token validation.

`GET /v1/live/{session_id}/stream` previously accepted (and discarded) any token
query parameter. These tests pin the contract that:

1. ``public_urls`` mints a per-session token AND persists it.
2. ``validate_stream_token`` is constant-time and only accepts the exact token.
3. ``stop_session`` evicts the token (post-stop replay must fail).
"""

from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def hub(monkeypatch, tmp_path):
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    from oaao_orchestrator.live_meeting import hub as hub_mod

    importlib.reload(hub_mod)
    # Reset in-memory stores for isolation.
    hub_mod._active.clear()
    hub_mod._stream_tokens.clear()
    return hub_mod


def test_public_urls_persists_token(hub):
    sid = "lm_test_session_A"
    urls = hub.public_urls(sid, public_base="http://orchestrator:8103")
    token = urls["stream_token"]

    assert token
    assert len(token) >= 16
    assert hub._stream_tokens[sid] == token
    # W10-S2: ws_audio_url must carry the token so the JS PCM uplink authenticates.
    assert urls["ws_audio_url"].endswith(f"?token={token}")
    assert urls["ws_audio_url"].startswith(f"/v1/live/{sid}/audio")


def test_validate_stream_token_accepts_exact_match(hub):
    sid = "lm_test_session_B"
    urls = hub.public_urls(sid, public_base="")
    token = urls["stream_token"]

    assert hub.validate_stream_token(sid, token) is True


def test_validate_stream_token_rejects_wrong_token(hub):
    sid = "lm_test_session_C"
    hub.public_urls(sid, public_base="")

    assert hub.validate_stream_token(sid, "wrong_token") is False
    assert hub.validate_stream_token(sid, "") is False


def test_validate_stream_token_rejects_unknown_session(hub):
    assert hub.validate_stream_token("lm_never_started", "any") is False


def test_validate_stream_token_rejects_empty_session(hub):
    sid = "lm_test_session_D"
    urls = hub.public_urls(sid, public_base="")
    token = urls["stream_token"]

    assert hub.validate_stream_token("", token) is False
    assert hub.validate_stream_token("   ", token) is False


@pytest.mark.asyncio
async def test_stop_session_evicts_token(hub, monkeypatch):
    sid = "lm_test_session_E"  # noqa: F841
    # Create a real session so stop_session can find it.
    session = hub.create_session(
        cadence="1v1",
        retention_mode="memory_only",
        workspace_id=None,
        user_id=None,
    )
    hub.public_urls(session.session_id, public_base="")
    assert hub.validate_stream_token(session.session_id, hub._stream_tokens[session.session_id])

    ok = await hub.stop_session(session.session_id, keep_audio=False)
    assert ok is True
    assert session.session_id not in hub._stream_tokens


# ── W10-S2: WebSocket audio uplink rejects callers without the per-session token ──


class _FakeWebSocket:
    """Minimal stand-in for `fastapi.WebSocket` — captures close code without I/O."""

    def __init__(self, *, incoming: list[dict] | None = None) -> None:
        self.closed_with: int | None = None
        self.accepted = False
        # Queue of pre-staged inbound messages for first-frame auth tests.
        self._incoming = list(incoming or [])

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code

    async def accept(self) -> None:  # pragma: no cover - should never be called on reject
        self.accepted = True

    async def receive(self) -> dict:
        if not self._incoming:
            # Block "forever" — wait_for will raise TimeoutError.
            import asyncio as _aio

            await _aio.sleep(3600)
        return self._incoming.pop(0)


@pytest.mark.asyncio
async def test_ws_audio_rejects_wrong_query_token(hub):
    sid = "lm_ws_reject_B"  # noqa: F841
    session = hub.create_session(cadence="1v1", retention_mode="memory_only")
    hub.public_urls(session.session_id, public_base="")

    ws = _FakeWebSocket()
    await hub.handle_audio_websocket(ws, session.session_id, token="not_the_real_token")

    assert ws.accepted is False
    assert ws.closed_with == 4401


@pytest.mark.asyncio
async def test_ws_audio_rejects_unknown_session(hub):
    ws = _FakeWebSocket()
    await hub.handle_audio_websocket(ws, "lm_never_started", token="any")

    assert ws.accepted is False
    assert ws.closed_with == 4401


# ── W10-S3: First-frame auth handshake (preferred path, no token in URL) ──


@pytest.mark.asyncio
async def test_first_frame_auth_accepts_valid_token(hub):
    sid = "lm_ff_ok"
    urls = hub.public_urls(sid, public_base="")
    token = urls["stream_token"]

    import json

    ws = _FakeWebSocket(
        incoming=[
            {"type": "websocket.receive", "text": json.dumps({"type": "auth", "token": token})}
        ]
    )
    ok = await hub._await_first_frame_auth(ws, sid)

    assert ok is True
    assert ws.closed_with is None


@pytest.mark.asyncio
async def test_first_frame_auth_rejects_bad_token(hub):
    sid = "lm_ff_bad"
    hub.public_urls(sid, public_base="")

    import json

    ws = _FakeWebSocket(
        incoming=[
            {"type": "websocket.receive", "text": json.dumps({"type": "auth", "token": "wrong"})}
        ]
    )
    ok = await hub._await_first_frame_auth(ws, sid)

    assert ok is False
    assert ws.closed_with == 4401


@pytest.mark.asyncio
async def test_first_frame_auth_rejects_malformed_json(hub):
    sid = "lm_ff_malformed"
    hub.public_urls(sid, public_base="")

    ws = _FakeWebSocket(incoming=[{"type": "websocket.receive", "text": "{not-json"}])
    ok = await hub._await_first_frame_auth(ws, sid)

    assert ok is False
    assert ws.closed_with == 4401


@pytest.mark.asyncio
async def test_first_frame_auth_rejects_wrong_message_type(hub):
    sid = "lm_ff_wrongtype"
    urls = hub.public_urls(sid, public_base="")

    import json

    ws = _FakeWebSocket(
        incoming=[
            {
                "type": "websocket.receive",
                "text": json.dumps({"type": "ping", "token": urls["stream_token"]}),
            }
        ]
    )
    ok = await hub._await_first_frame_auth(ws, sid)

    assert ok is False
    assert ws.closed_with == 4401


@pytest.mark.asyncio
async def test_first_frame_auth_timeout_closes_4401(hub):
    sid = "lm_ff_timeout"
    hub.public_urls(sid, public_base="")

    ws = _FakeWebSocket(incoming=[])  # no incoming → wait_for times out
    ok = await hub._await_first_frame_auth(ws, sid, timeout=0.05)

    assert ok is False
    assert ws.closed_with == 4401


@pytest.mark.asyncio
async def test_first_frame_auth_handles_immediate_disconnect(hub):
    sid = "lm_ff_disc"
    hub.public_urls(sid, public_base="")

    ws = _FakeWebSocket(incoming=[{"type": "websocket.disconnect"}])
    ok = await hub._await_first_frame_auth(ws, sid)

    assert ok is False
    # Disconnect path does not call close() — peer is already gone.
    assert ws.closed_with is None
