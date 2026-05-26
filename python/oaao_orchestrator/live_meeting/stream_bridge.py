"""
Live ASR duplex streaming — driver registry and factory.

Add new upstream WS providers by implementing ``LiveStreamAsrBridge`` and extending
``resolve_stream_driver`` + ``create_and_start_live_stream_bridge``.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Protocol, runtime_checkable
from urllib.parse import urlparse

from oaao_orchestrator.live_meeting.qwen_asr_stream import (
    is_streaming_asr_mode,
    use_dashscope_realtime_stream,
    use_remote_pcm_stream_bridge,
)

logger = logging.getLogger(__name__)

EmitCallback = Callable[[str, bool], Awaitable[None]]
OnFatalCallback = Callable[[str], Awaitable[None]]


@runtime_checkable
class LiveStreamAsrBridge(Protocol):
    """Minimal contract for orchestrator live-meeting WS upstream bridges."""

    async def start(self) -> None: ...

    async def push_pcm(self, chunk: bytes) -> None: ...

    async def close(self) -> None: ...


def _coerce_live_stream_ws_url(raw: str) -> str:
    """ASR-Live payloads: http(s) base_url → ws(s) stream URL."""
    u = raw.strip()
    if not u:
        return ""
    lower = u.lower()
    if lower.startswith(("ws://", "wss://")):
        return u.rstrip("/")
    if not lower.startswith(("http://", "https://")):
        return ""
    parsed = urlparse(u)
    host = parsed.hostname or ""
    if not host:
        return ""
    ws_scheme = "ws" if lower.startswith("http://") else "wss"
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path.rstrip("/")
    return f"{ws_scheme}://{host}{port}{path}"


def resolve_live_stream_ws_url(asr_cfg: dict[str, Any] | None) -> str:
    """First WebSocket URL from Purpose / endpoint payload."""
    if not isinstance(asr_cfg, dict):
        return ""
    for key in ("funasr_stream_url", "ws_url", "dashscope_ws_url", "base_url"):
        raw = str(asr_cfg.get(key) or "").strip()
        if raw.lower().startswith(("ws://", "wss://")):
            return raw
        coerced = _coerce_live_stream_ws_url(raw)
        if coerced:
            return coerced
    return ""


def infer_funasr_stream_driver(ws_url: str) -> str:
    """Pick FunASR-family driver from WS URL host (proxy vs raw runtime)."""
    host = (urlparse(ws_url).hostname or "").lower()
    if "funasr-nano-ws" in host or host.startswith("funasr-nano-ws."):
        return "funasr_nano_ws"
    return "funasr_runtime"


def resolve_stream_driver(asr_cfg: dict[str, Any] | None) -> str | None:
    """
    Pick streaming driver id for ``asr.live`` payload.

    Known drivers:
    - ``dashscope`` — Alibaba Cloud duplex WS
    - ``funasr_nano_ws`` — JSON/base64 proxy (``funasr-nano-ws.*``)
    - ``funasr_runtime`` — raw FunASR wss-server binary PCM (port 10095)
    Override with ``stream_protocol`` / ``live_stream_protocol`` in purpose meta.
    """
    if not is_streaming_asr_mode(asr_cfg) or not isinstance(asr_cfg, dict):
        return None

    explicit = str(
        asr_cfg.get("stream_protocol") or asr_cfg.get("live_stream_protocol") or ""
    ).strip().lower()
    if explicit:
        return explicit

    if use_dashscope_realtime_stream(asr_cfg):
        return "dashscope"
    if use_remote_pcm_stream_bridge(asr_cfg):
        ws_url = resolve_live_stream_ws_url(asr_cfg)
        return infer_funasr_stream_driver(ws_url)
    return None


async def create_and_start_live_stream_bridge(
    *,
    session_id: str,
    asr_cfg: dict[str, Any],
    on_emit: EmitCallback,
    glossary: dict[str, Any] | None = None,
    on_fatal: OnFatalCallback | None = None,
) -> LiveStreamAsrBridge:
    driver = resolve_stream_driver(asr_cfg)
    if not driver:
        raise RuntimeError("live_stream_driver_unresolved")

    if driver == "dashscope":
        from oaao_orchestrator.live_meeting.dashscope_asr_stream import create_and_start_bridge

        return await create_and_start_bridge(
            session_id=session_id,
            asr_cfg=asr_cfg,
            on_emit=on_emit,
            glossary=glossary,
        )

    if driver == "funasr_nano_ws":
        from oaao_orchestrator.live_meeting.funasr_nano_ws_stream import (
            create_and_start_funasr_nano_ws_bridge,
        )

        return await create_and_start_funasr_nano_ws_bridge(
            session_id=session_id,
            asr_cfg=asr_cfg,
            on_emit=on_emit,
            glossary=glossary,
            on_fatal=on_fatal,
        )

    if driver == "funasr_runtime":
        from oaao_orchestrator.live_meeting.funasr_runtime_stream import (
            create_and_start_funasr_runtime_bridge,
        )

        return await create_and_start_funasr_runtime_bridge(
            session_id=session_id,
            asr_cfg=asr_cfg,
            on_emit=on_emit,
            glossary=glossary,
        )

    raise RuntimeError(f"live_stream_driver_unknown:{driver}")
