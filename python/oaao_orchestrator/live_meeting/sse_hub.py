"""Per-session SSE buffer for live meeting transcript events."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator

from oaao_orchestrator.streaming.events import StreamEnvelope
from oaao_orchestrator.streaming.sse import encode_sse


def _sse_keepalive_interval_sec() -> float:
    raw = os.environ.get("OAAO_SSE_KEEPALIVE_SEC", "15").strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 15.0


class LiveStreamHub:
    """Replay + tail SSE for one live session (independent of chat ``StreamRun``)."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._events: list[tuple[int, StreamEnvelope]] = []
        self._seq = 0
        self._done = asyncio.Event()
        self._waiters: list[asyncio.Queue[tuple[int, StreamEnvelope]]] = []

    def mark_done(self) -> None:
        self._done.set()
        sentinel = StreamEnvelope(phase="system", kind="end", text="live_session_closed")
        for q in self._waiters:
            q.put_nowait((-1, sentinel))

    async def append(self, env: StreamEnvelope) -> int:
        self._seq += 1
        sid = self._seq
        self._events.append((sid, env))
        for q in self._waiters:
            await q.put((sid, env))
        return sid

    def snapshot_since(self, since_seq: int) -> list[tuple[int, StreamEnvelope]]:
        return [(s, e) for s, e in self._events if s > since_seq]

    async def subscribe(self, since_seq: int) -> AsyncIterator[str]:
        for sid, env in self.snapshot_since(since_seq):
            yield encode_sse(seq_id=sid, event_name="oaao.stream", data=env.model_dump())

        if self._done.is_set():
            return

        queue: asyncio.Queue[tuple[int, StreamEnvelope]] = asyncio.Queue()
        self._waiters.append(queue)
        keepalive_sec = _sse_keepalive_interval_sec()
        try:
            while True:
                try:
                    sid, env = await asyncio.wait_for(queue.get(), timeout=keepalive_sec)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if sid < 0:
                    break
                yield encode_sse(seq_id=sid, event_name="oaao.stream", data=env.model_dump())
        finally:
            try:
                self._waiters.remove(queue)
            except ValueError:
                pass


_streams: dict[str, LiveStreamHub] = {}


def get_live_stream(session_id: str) -> LiveStreamHub:
    sid = (session_id or "").strip()
    hub = _streams.get(sid)
    if hub is None:
        hub = LiveStreamHub(sid)
        _streams[sid] = hub
    return hub


def drop_live_stream(session_id: str) -> None:
    sid = (session_id or "").strip()
    hub = _streams.pop(sid, None)
    if hub is not None:
        hub.mark_done()
