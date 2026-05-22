"""
Buffered stream runs — **client disconnect does not cancel** upstream producers.

- ``append``: producers (single Pipeline / agent loop) push envelopes; seq monotonic.
- ``subscribe``: SSE handler **replays** ``seq > since_seq`` then tails ``_waiters`` until ``done``.
- ``request_cancel``: explicit user Stop — cooperative; distinct from browser abort.

Resume contract (HTTP layer): ``GET ...?since_seq=N`` or ``Last-Event-ID: N`` → replay then live tail.
"""

from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator

from oaao_orchestrator.streaming.events import StreamEnvelope
from oaao_orchestrator.streaming.sse import encode_sse


def _sse_keepalive_interval_sec() -> float:
    raw = os.environ.get("OAAO_SSE_KEEPALIVE_SEC", "15").strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 15.0


class StreamRun:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self._lock = asyncio.Lock()
        self._events: list[tuple[int, StreamEnvelope]] = []
        self._seq = 0
        self._done = asyncio.Event()
        self._waiters: list[asyncio.Queue[tuple[int, StreamEnvelope]]] = []
        self._cancel_requested = False
        self._agent_ask_futures: dict[str, asyncio.Future[str]] = {}

    @property
    def cancelled(self) -> bool:
        return self._cancel_requested

    def request_cancel(self) -> None:
        """User pressed Stop — upstream should observe and unwind (optional)."""
        self._cancel_requested = True
        for fut in list(self._agent_ask_futures.values()):
            if not fut.done():
                fut.set_result("skip")

    def register_agent_ask(self, run_task_id: str) -> asyncio.Future[str]:
        """Block until {@link resolve_agent_ask} or cancel (decision: proceed|skip)."""
        tid = (run_task_id or "").strip()
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[str] = loop.create_future()
        self._agent_ask_futures[tid] = fut
        return fut

    def resolve_agent_ask(self, run_task_id: str, decision: str) -> bool:
        tid = (run_task_id or "").strip()
        if not tid:
            return False
        dec = (decision or "").strip().lower()
        if dec not in ("proceed", "skip"):
            dec = "skip"

        candidates: list[str] = []
        seen: set[str] = set()

        def _add(key: str) -> None:
            k = (key or "").strip()
            if not k or k in seen:
                return
            seen.add(k)
            candidates.append(k)

        _add(tid)
        if tid.endswith("-outline"):
            _add(tid[: -len("-outline")])
        else:
            _add(f"{tid}-outline")

        for key in candidates:
            fut = self._agent_ask_futures.pop(key, None)
            if fut is not None and not fut.done():
                fut.set_result(dec)
                return True

        pending = [k for k, f in self._agent_ask_futures.items() if not f.done()]
        if len(pending) == 1:
            only = pending[0]
            group = tid[:-8] if tid.endswith("-outline") else tid
            if only == tid or only == f"{group}-outline" or only == group:
                fut = self._agent_ask_futures.pop(only, None)
                if fut is not None and not fut.done():
                    fut.set_result(dec)
                    return True

        return False

    def discard_agent_ask(self, run_task_id: str) -> None:
        self._agent_ask_futures.pop((run_task_id or "").strip(), None)

    def mark_done(self) -> None:
        self._done.set()
        sentinel = StreamEnvelope(phase="system", kind="end", text="run_closed")
        for q in self._waiters:
            q.put_nowait((-1, sentinel))

    async def append(self, env: StreamEnvelope) -> int:
        async with self._lock:
            self._seq += 1
            sid = self._seq
            self._events.append((sid, env))
        for q in self._waiters:
            await q.put((sid, env))
        return sid

    def snapshot_since(self, since_seq: int) -> list[tuple[int, StreamEnvelope]]:
        return [(s, e) for s, e in self._events if s > since_seq]

    async def subscribe(self, since_seq: int) -> AsyncIterator[str]:
        """Yield SSE text chunks (replay + tail)."""
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
                except asyncio.TimeoutError:
                    # Prevent browser/proxy idle disconnect during long planner/agent/ask gaps.
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


class StreamSessionRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, StreamRun] = {}

    def create(self, run_id: str) -> StreamRun:
        run = StreamRun(run_id)
        self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> StreamRun | None:
        return self._runs.get(run_id)
