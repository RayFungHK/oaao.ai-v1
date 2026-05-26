"""
FunASR runtime WebSocket streaming (``funasr_wss_server`` / port 10095 style).

Protocol: https://github.com/modelscope/FunASR/blob/main/runtime/docs/websocket_protocol.md
- First JSON config (``mode``, ``chunk_size``, ``is_speaking``, …)
- Binary PCM s16le 16 kHz mono
- End with ``{"is_speaking": false}``
- Server JSON: ``text`` + ``mode`` (``2pass-online`` partial, ``2pass-offline`` final)
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from oaao_orchestrator.live_meeting.audio_store import SAMPLE_RATE
from oaao_orchestrator.live_meeting.glossary_hotwords import hotwords_json_for_dashscope
from oaao_orchestrator.live_meeting.stream_bridge import EmitCallback, resolve_live_stream_ws_url

logger = logging.getLogger(__name__)

_DEFAULT_CHUNK_SIZE = [5, 10, 5]
_DEFAULT_CHUNK_INTERVAL = 10


def parse_funasr_runtime_message(msg: dict[str, Any]) -> tuple[str, bool] | None:
    """Extract (text, is_final) from a FunASR runtime WS JSON message."""
    if not isinstance(msg, dict):
        return None
    text = str(msg.get("text") or msg.get("result") or msg.get("transcript") or "").strip()
    if not text:
        return None

    if "is_final" in msg:
        return text, bool(msg.get("is_final"))

    mode = str(msg.get("mode") or "").strip().lower()
    if mode in ("offline", "2pass-offline") or mode.endswith("-offline"):
        return text, True
    if mode in ("online", "2pass-online") or mode.endswith("-online"):
        return text, False
    # Unknown mode — treat as partial unless sentence_end flag present
    sentence_end = msg.get("sentence_end")
    if sentence_end is not None:
        return text, bool(sentence_end)
    return text, False


def _resolve_chunk_size(asr_cfg: dict[str, Any]) -> list[int]:
    raw = asr_cfg.get("chunk_size")
    if isinstance(raw, list) and raw:
        out = [int(x) for x in raw[:3]]
        if len(out) == 3:
            return out
    if isinstance(raw, str) and raw.strip():
        parts = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
        if len(parts) >= 3:
            return [int(parts[0]), int(parts[1]), int(parts[2])]
    return list(_DEFAULT_CHUNK_SIZE)


class FunasrRuntimeStreamBridge:
    """Forward PCM to FunASR runtime WS and invoke ``on_emit(text, is_final)``."""

    def __init__(
        self,
        *,
        session_id: str,
        asr_cfg: dict[str, Any],
        on_emit: EmitCallback,
        glossary: dict[str, Any] | None = None,
    ) -> None:
        self.session_id = session_id
        self.asr_cfg = asr_cfg
        self.on_emit = on_emit
        self._ws_url = resolve_live_stream_ws_url(asr_cfg)
        self._model = str(asr_cfg.get("model") or "").strip()
        self._mode = str(asr_cfg.get("stream_mode") or asr_cfg.get("funasr_stream_mode") or "2pass").strip()
        self._chunk_size = _resolve_chunk_size(asr_cfg)
        self._chunk_interval = int(asr_cfg.get("chunk_interval") or _DEFAULT_CHUNK_INTERVAL)
        self._language = str(asr_cfg.get("language") or "").strip()
        self._itn = bool(asr_cfg.get("itn", asr_cfg.get("enable_itn", True)))
        self._glossary = glossary if isinstance(glossary, dict) else None
        self._ws: Any = None
        self._recv_task: asyncio.Task[Any] | None = None
        self._send_task: asyncio.Task[Any] | None = None
        self._audio_q: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._config_sent = False
        self._closed = False

    async def start(self) -> None:
        if not self._ws_url:
            raise RuntimeError("funasr_stream_url_missing")
        try:
            import websockets  # noqa: PLC0415
        except ImportError as e:
            raise RuntimeError("websockets package required") from e

        self._ws = await websockets.connect(self._ws_url, open_timeout=20.0)
        await self._send_start_config()
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())
        logger.info(
            "live_meeting funasr_runtime_stream_started id=%s url=%s mode=%s model=%s",
            self.session_id,
            self._ws_url[:80],
            self._mode,
            self._model or "(default)",
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
        if self._ws and self._config_sent:
            try:
                await self._ws.send(json.dumps({"is_speaking": False}))
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
        logger.info("live_meeting funasr_runtime_stream_closed id=%s", self.session_id)

    async def _send_start_config(self) -> None:
        assert self._ws is not None
        body: dict[str, Any] = {
            "mode": self._mode or "2pass",
            "chunk_size": self._chunk_size,
            "chunk_interval": self._chunk_interval,
            "wav_name": f"oaao_{self.session_id[:12]}",
            "wav_format": "pcm",
            "audio_fs": SAMPLE_RATE,
            "is_speaking": True,
            "itn": self._itn,
            "encoder_chunk_look_back": int(self.asr_cfg.get("encoder_chunk_look_back") or 4),
            "decoder_chunk_look_back": int(self.asr_cfg.get("decoder_chunk_look_back") or 1),
        }
        if self._language:
            body["svs_lang"] = self._language
        hotwords = hotwords_json_for_dashscope(self._glossary)
        if hotwords:
            body["hotwords"] = hotwords
        await self._ws.send(json.dumps(body, ensure_ascii=False))
        self._config_sent = True

    async def _send_loop(self) -> None:
        while True:
            chunk = await self._audio_q.get()
            if chunk is None:
                break
            if not self._ws or not self._config_sent:
                continue
            await self._ws.send(chunk)

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
            logger.warning("live_meeting funasr_runtime_recv id=%s err=%s", self.session_id, e)

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        parsed = parse_funasr_runtime_message(msg)
        if parsed is None:
            return
        text, is_final = parsed
        await self.on_emit(text, is_final)


async def create_and_start_funasr_runtime_bridge(
    *,
    session_id: str,
    asr_cfg: dict[str, Any],
    on_emit: EmitCallback,
    glossary: dict[str, Any] | None = None,
) -> FunasrRuntimeStreamBridge:
    bridge = FunasrRuntimeStreamBridge(
        session_id=session_id,
        asr_cfg=asr_cfg,
        on_emit=on_emit,
        glossary=glossary,
    )
    await bridge.start()
    return bridge
