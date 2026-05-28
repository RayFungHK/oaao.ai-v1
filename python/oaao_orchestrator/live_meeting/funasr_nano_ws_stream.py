"""
FunASR Nano JSON WebSocket proxy (``funasr-nano-ws.*`` tunnel frontends).

Observed protocol (2026-05):
- Server → ``{"event": "ready", "port": 10095}``
- Client → ``{"event": "start", "language": "…", "itn": true, "mode": "2pass"}``
- Client → ``{"type": "audio", "data": "<base64 pcm s16le>"}`` per chunk
- Client → ``{"event": "stop"}`` on close
- Server → ``{"event": "ack", …}`` | ``{"event": "error", …}`` | transcript fields
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from oaao_orchestrator.asr_common import (
    normalize_funasr_stream_language,
    sanitize_asr_transcript_text,
    should_discard_funasr_stream_emit,
)
from oaao_orchestrator.live_meeting.stream_bridge import EmitCallback, resolve_live_stream_ws_url

logger = logging.getLogger(__name__)

OnFatalCallback = Callable[[str], Awaitable[None]]


def parse_funasr_nano_ws_message(msg: dict[str, Any]) -> tuple[str | None, bool | None, str | None]:
    """
    Returns (text, is_final, fatal_error).

    ``fatal_error`` when the proxy reports an unrecoverable upstream failure.
    """
    if not isinstance(msg, dict):
        return None, None, None

    event = str(msg.get("event") or "").strip().lower()
    if event == "error":
        err = str(msg.get("error") or msg.get("detail") or "funasr_nano_ws_error").strip()
        return None, None, err or "funasr_nano_ws_error"
    if event in ("ready", "ack", "pong"):
        return None, None, None

    text = str(msg.get("text") or msg.get("transcript") or msg.get("result") or "").strip()
    if not text and isinstance(msg.get("data"), dict):
        data = msg["data"]
        if isinstance(data, dict):
            text = str(data.get("text") or data.get("transcript") or "").strip()

    if not text:
        return None, None, None

    if "is_final" in msg:
        return text, bool(msg.get("is_final")), None
    if event in ("final", "transcript", "result", "complete", "stop"):
        return text, True, None
    if event in ("partial", "online", "2pass-online"):
        return text, False, None
    return text, False, None


class FunasrNanoWsStreamBridge:
    """JSON/base64 PCM bridge for FunASR Nano WS proxy endpoints."""

    def __init__(
        self,
        *,
        session_id: str,
        asr_cfg: dict[str, Any],
        on_emit: EmitCallback,
        glossary: dict[str, Any] | None = None,
        on_fatal: OnFatalCallback | None = None,
    ) -> None:
        self.session_id = session_id
        self.asr_cfg = asr_cfg
        self.on_emit = on_emit
        self._on_fatal = on_fatal
        self._ws_url = resolve_live_stream_ws_url(asr_cfg)
        self._model = str(asr_cfg.get("model") or "").strip()
        self._language = normalize_funasr_stream_language(
            str(asr_cfg.get("language") or asr_cfg.get("preferred_language") or "")
        )
        self._itn = bool(asr_cfg.get("itn", asr_cfg.get("enable_itn", True)))
        self._mode = str(
            asr_cfg.get("stream_mode") or asr_cfg.get("funasr_stream_mode") or "2pass"
        ).strip()
        self._ws: Any = None
        self._recv_task: asyncio.Task[Any] | None = None
        self._send_task: asyncio.Task[Any] | None = None
        self._audio_q: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._started = False
        self._closed = False
        self._glossary = glossary if isinstance(glossary, dict) else None

    async def start(self) -> None:
        if not self._ws_url:
            raise RuntimeError("funasr_stream_url_missing")
        try:
            import websockets
        except ImportError as e:
            raise RuntimeError("websockets package required") from e

        self._ws = await websockets.connect(self._ws_url, open_timeout=20.0)
        await self._wait_ready()
        await self._send_start()
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())
        self._started = True
        logger.info(
            "live_meeting funasr_nano_ws_started id=%s url=%s model=%s language=%s",
            self.session_id,
            self._ws_url[:80],
            self._model or "(default)",
            self._language,
        )

    async def push_pcm(self, chunk: bytes) -> None:
        if self._closed or not chunk:
            return
        await self._audio_q.put(bytes(chunk))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._audio_q.put(None)
        if self._ws and self._started:
            try:
                await self._ws.send(json.dumps({"event": "stop"}))
            except Exception:  # noqa: BLE001
                pass
        for task in (self._send_task, self._recv_task):
            if task is not None and not task.done():
                task.cancel()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
        logger.info("live_meeting funasr_nano_ws_closed id=%s", self.session_id)

    async def _wait_ready(self) -> None:
        assert self._ws is not None
        raw = await asyncio.wait_for(self._ws.recv(), timeout=15.0)
        if isinstance(raw, bytes):
            return
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if isinstance(msg, dict) and str(msg.get("event") or "").lower() == "ready":
            return
        await self._handle_message(msg)

    async def _send_start(self) -> None:
        assert self._ws is not None
        body: dict[str, Any] = {
            "event": "start",
            "language": self._language,
            "itn": self._itn,
            "mode": self._mode or "2pass",
        }
        if self._model:
            body["model"] = self._model
        await self._ws.send(json.dumps(body, ensure_ascii=False))
        try:
            raw = await asyncio.wait_for(self._ws.recv(), timeout=5.0)
            if isinstance(raw, str):
                msg = json.loads(raw)
                if isinstance(msg, dict):
                    await self._handle_message(msg)
        except (TimeoutError, json.JSONDecodeError):
            pass

    async def _send_loop(self) -> None:
        while True:
            chunk = await self._audio_q.get()
            if chunk is None:
                break
            if not self._ws or not self._started:
                continue
            payload = {"type": "audio", "data": base64.b64encode(chunk).decode("ascii")}
            await self._ws.send(json.dumps(payload))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(msg, dict):
                    continue
                await self._handle_message(msg)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("live_meeting funasr_nano_ws_recv id=%s err=%s", self.session_id, e)
            await self._fatal(f"recv_closed:{str(e)[:120]}")

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        event = str(msg.get("event") or "").strip().lower()
        if event == "ack":
            logger.debug(
                "live_meeting funasr_nano_ws_ack id=%s msg=%s",
                self.session_id,
                json.dumps(msg, ensure_ascii=False)[:200],
            )
        text, is_final, fatal = parse_funasr_nano_ws_message(msg)
        if fatal:
            await self._fatal(fatal)
            return
        if text and is_final is not None:
            raw = text
            cleaned = sanitize_asr_transcript_text(raw)
            if should_discard_funasr_stream_emit(raw, cleaned, is_final=is_final):
                return
            logger.info(
                "live_meeting funasr_nano_ws_emit id=%s final=%s text=%s",
                self.session_id,
                is_final,
                cleaned[:80],
            )
            await self.on_emit(cleaned, is_final)

    async def _fatal(self, reason: str) -> None:
        logger.warning(
            "live_meeting funasr_nano_ws_fatal id=%s reason=%s", self.session_id, reason[:200]
        )
        if self._on_fatal is not None:
            await self._on_fatal(reason)


async def create_and_start_funasr_nano_ws_bridge(
    *,
    session_id: str,
    asr_cfg: dict[str, Any],
    on_emit: EmitCallback,
    glossary: dict[str, Any] | None = None,
    on_fatal: OnFatalCallback | None = None,
) -> FunasrNanoWsStreamBridge:
    bridge = FunasrNanoWsStreamBridge(
        session_id=session_id,
        asr_cfg=asr_cfg,
        on_emit=on_emit,
        glossary=glossary,
        on_fatal=on_fatal,
    )
    await bridge.start()
    return bridge
