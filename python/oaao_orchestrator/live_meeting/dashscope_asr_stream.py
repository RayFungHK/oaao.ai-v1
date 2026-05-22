"""
Alibaba Cloud Model Studio real-time ASR over WebSocket.

Protocols (see Alibaba real-time speech recognition user guide):
- Fun-ASR / Paraformer: ``wss://…/api-ws/v1/inference/`` — run-task + binary PCM + result-generated
- Qwen3-ASR Realtime: ``wss://…/api-ws/v1/realtime?model=…`` — session.update + input_audio_buffer.append
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import secrets
import uuid
from typing import Any, Awaitable, Callable

from oaao_orchestrator.live_meeting.audio_store import SAMPLE_RATE
from oaao_orchestrator.live_meeting.glossary_hotwords import hotwords_json_for_dashscope

logger = logging.getLogger(__name__)

EmitCallback = Callable[[str, bool], Awaitable[None]]

_DEFAULT_FUNASR_WS_INTL = "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference/"
_DEFAULT_QWEN_WS_INTL = "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime"


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def dashscope_api_key(asr_cfg: dict[str, Any]) -> str | None:
    key = _resolve_secret(asr_cfg.get("api_key_env") if isinstance(asr_cfg.get("api_key_env"), str) else None)
    if key:
        return key
    for env in ("DASHSCOPE_API_KEY", "ALIBABA_CLOUD_API_KEY"):
        v = os.environ.get(env)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def is_qwen_realtime_model(model: str) -> bool:
    m = (model or "").strip().lower()
    return "qwen" in m and "realtime" in m


def resolve_dashscope_ws_url(asr_cfg: dict[str, Any]) -> tuple[str, str]:
    """Returns (ws_url, protocol) where protocol is ``funasr`` or ``qwen``."""
    model = str(asr_cfg.get("model") or "fun-asr-realtime").strip()
    explicit = str(asr_cfg.get("dashscope_ws_url") or asr_cfg.get("ws_url") or "").strip()
    region = str(asr_cfg.get("dashscope_region") or asr_cfg.get("region") or "intl").strip().lower()

    if explicit.startswith("wss://") or explicit.startswith("ws://"):
        url = explicit
        proto = "qwen" if is_qwen_realtime_model(model) or "/realtime" in url else "funasr"
        return url, proto

    cn = region in ("cn", "beijing", "china", "cn-beijing")
    if is_qwen_realtime_model(model):
        base = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime" if cn else _DEFAULT_QWEN_WS_INTL
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}model={model}", "qwen"

    return (
        "wss://dashscope.aliyuncs.com/api-ws/v1/inference/" if cn else _DEFAULT_FUNASR_WS_INTL,
        "funasr",
    )


class DashscopeRealtimeAsrBridge:
    """Forward PCM to DashScope and invoke ``on_emit(text, is_final)``."""

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
        self._api_key = dashscope_api_key(asr_cfg)
        self._model = str(asr_cfg.get("model") or "fun-asr-realtime").strip()
        self._ws_url, self._protocol = resolve_dashscope_ws_url(asr_cfg)
        lang = str(asr_cfg.get("language") or "").strip()
        if not lang:
            hints = asr_cfg.get("language_hints")
            if isinstance(hints, list) and hints:
                lang = str(hints[0] or "").strip()
            elif isinstance(hints, str):
                lang = hints.strip()
        self._language = lang
        self._task_id = secrets.token_hex(16)
        self._ws: Any = None
        self._recv_task: asyncio.Task[Any] | None = None
        self._send_task: asyncio.Task[Any] | None = None
        self._audio_q: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._started = False
        self._closed = False
        self._task_started = False
        self._glossary = glossary if isinstance(glossary, dict) else None

    async def start(self) -> None:
        if not self._api_key:
            raise RuntimeError("dashscope_api_key_missing")
        try:
            import websockets  # noqa: PLC0415
        except ImportError as e:
            raise RuntimeError("websockets package required") from e

        headers = {"Authorization": f"bearer {self._api_key}"}
        if self._protocol == "qwen":
            headers["OpenAI-Beta"] = "realtime=v1"

        self._ws = await websockets.connect(self._ws_url, additional_headers=headers)
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())
        if self._protocol == "funasr":
            await self._send_run_task()
        else:
            await asyncio.sleep(0.3)
            await self._send_qwen_session_update()
        logger.info(
            "live_meeting dashscope_asr_started id=%s protocol=%s model=%s",
            self.session_id,
            self._protocol,
            self._model,
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
        if self._protocol == "funasr" and self._ws and self._task_started:
            try:
                await self._send_finish_task()
            except Exception:  # noqa: BLE001
                pass
        elif self._protocol == "qwen" and self._ws:
            try:
                await self._ws.send(
                    json.dumps({"type": "session.finish", "event_id": f"evt_{uuid.uuid4().hex[:12]}"})
                )
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
        logger.info("live_meeting dashscope_asr_closed id=%s", self.session_id)

    async def _send_loop(self) -> None:
        while True:
            chunk = await self._audio_q.get()
            if chunk is None:
                break
            if not self._ws:
                continue
            if self._protocol == "funasr":
                if not self._task_started:
                    await self._audio_q.put(chunk)
                    await asyncio.sleep(0.05)
                    continue
                await self._ws.send(chunk)
            else:
                payload = {
                    "type": "input_audio_buffer.append",
                    "event_id": f"evt_{uuid.uuid4().hex[:12]}",
                    "audio": base64.b64encode(chunk).decode("ascii"),
                }
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
                await self._handle_message(msg)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("live_meeting dashscope_recv id=%s err=%s", self.session_id, e)

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        if self._protocol == "funasr":
            header = msg.get("header") if isinstance(msg.get("header"), dict) else {}
            event = str(header.get("event") or "")
            if event == "task-started":
                self._task_started = True
                return
            if event == "task-failed":
                err = str(header.get("error_message") or "task_failed")
                logger.warning("live_meeting dashscope task_failed id=%s %s", self.session_id, err)
                return
            if event == "result-generated":
                payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
                output = payload.get("output") if isinstance(payload.get("output"), dict) else {}
                sentence = output.get("sentence") if isinstance(output.get("sentence"), dict) else {}
                text = str(sentence.get("text") or "").strip()
                if not text:
                    return
                is_final = bool(sentence.get("sentence_end"))
                await self.on_emit(text, is_final)
            return

        ev_type = str(msg.get("type") or "")
        if ev_type == "conversation.item.input_audio_transcription.text":
            text = str(msg.get("text") or "").strip()
            stash = str(msg.get("stash") or "").strip()
            combined = (text + stash).strip()
            if combined:
                await self.on_emit(combined, False)
        elif ev_type == "conversation.item.input_audio_transcription.completed":
            text = str(msg.get("transcript") or msg.get("text") or "").strip()
            if text:
                await self.on_emit(text, True)

    async def _send_run_task(self) -> None:
        assert self._ws is not None
        fmt = str(self.asr_cfg.get("format") or "pcm").strip() or "pcm"
        parameters: dict[str, Any] = {
            "sample_rate": SAMPLE_RATE,
            "format": fmt,
        }
        hotwords = hotwords_json_for_dashscope(self._glossary)
        if hotwords:
            parameters["hotwords"] = hotwords
        body = {
            "header": {
                "action": "run-task",
                "task_id": self._task_id,
                "streaming": "duplex",
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": self._model,
                "parameters": parameters,
                "input": {},
            },
        }
        await self._ws.send(json.dumps(body))

    async def _send_finish_task(self) -> None:
        assert self._ws is not None
        body = {
            "header": {
                "action": "finish-task",
                "task_id": self._task_id,
                "streaming": "duplex",
            },
            "payload": {"input": {}},
        }
        await self._ws.send(json.dumps(body))

    async def _send_qwen_session_update(self) -> None:
        assert self._ws is not None
        transcription: dict[str, Any] = {}
        if self._language:
            transcription["language"] = self._language
        session: dict[str, Any] = {
            "modalities": ["text"],
            "input_audio_format": "pcm",
            "sample_rate": SAMPLE_RATE,
            "input_audio_transcription": transcription,
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.0,
                "silence_duration_ms": 400,
            },
        }
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "event_id": f"evt_{uuid.uuid4().hex[:12]}",
                    "session": session,
                }
            )
        )


async def create_and_start_bridge(
    *,
    session_id: str,
    asr_cfg: dict[str, Any],
    on_emit: EmitCallback,
    glossary: dict[str, Any] | None = None,
) -> DashscopeRealtimeAsrBridge:
    bridge = DashscopeRealtimeAsrBridge(
        session_id=session_id,
        asr_cfg=asr_cfg,
        on_emit=on_emit,
        glossary=glossary,
    )
    await bridge.start()
    return bridge
