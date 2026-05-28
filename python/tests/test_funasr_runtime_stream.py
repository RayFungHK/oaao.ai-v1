from __future__ import annotations

import pytest
from oaao_orchestrator.live_meeting.funasr_nano_ws_stream import (
    FunasrNanoWsStreamBridge,
    parse_funasr_nano_ws_message,
)
from oaao_orchestrator.live_meeting.funasr_runtime_stream import (
    FunasrRuntimeStreamBridge,
    parse_funasr_runtime_message,
)
from oaao_orchestrator.live_meeting.stream_bridge import (
    infer_funasr_stream_driver,
    resolve_stream_driver,
)


def test_infer_funasr_stream_driver_nano_ws() -> None:
    assert infer_funasr_stream_driver("wss://funasr-nano-ws.rayfung.hk") == "funasr_nano_ws"
    assert infer_funasr_stream_driver("ws://127.0.0.1:10095") == "funasr_runtime"


def test_parse_funasr_nano_ws_transcript() -> None:
    out = parse_funasr_nano_ws_message({"event": "transcript", "text": "你好"})
    assert out == ("你好", True, None)


def test_parse_funasr_nano_ws_error() -> None:
    out = parse_funasr_nano_ws_message({"event": "error", "error": "boom"})
    assert out == (None, None, "boom")


def test_resolve_stream_driver_funasr_nano_ws_http_coerced() -> None:
    cfg = {
        "provider": "funasr_nano",
        "mode": "streaming",
        "base_url": "http://127.0.0.1:10095",
        "model": "FunAudioLLM/Fun-ASR-Nano-2512",
    }
    assert resolve_stream_driver(cfg) == "funasr_runtime"


def test_resolve_stream_driver_funasr_nano_ws_https_coerced() -> None:
    cfg = {
        "provider": "funasr_nano",
        "mode": "streaming",
        "base_url": "https://funasr-nano-ws.rayfung.hk",
        "model": "FunAudioLLM/Fun-ASR-Nano-2512",
    }
    assert resolve_stream_driver(cfg) == "funasr_nano_ws"


def test_resolve_stream_driver_funasr_nano_ws() -> None:
    cfg = {
        "provider": "funasr_nano",
        "mode": "streaming",
        "funasr_stream_url": "wss://funasr-nano-ws.rayfung.hk",
        "model": "FunAudioLLM/Fun-ASR-Nano-2512",
    }
    assert resolve_stream_driver(cfg) == "funasr_nano_ws"
    out = parse_funasr_runtime_message({"mode": "2pass-online", "text": "你好"})
    assert out == ("你好", False)


def test_parse_funasr_runtime_offline_final() -> None:
    out = parse_funasr_runtime_message({"mode": "2pass-offline", "text": "你好世界"})
    assert out == ("你好世界", True)


def test_parse_funasr_runtime_is_final_flag() -> None:
    out = parse_funasr_runtime_message({"text": "done", "is_final": True})
    assert out == ("done", True)


def test_resolve_stream_driver_funasr_runtime() -> None:
    cfg = {
        "provider": "funasr_nano",
        "mode": "streaming",
        "funasr_stream_url": "ws://127.0.0.1:10095",
        "model": "FunAudioLLM/Fun-ASR-Nano-2512",
    }
    assert resolve_stream_driver(cfg) == "funasr_runtime"


def test_resolve_stream_driver_explicit_protocol() -> None:
    cfg = {
        "mode": "streaming",
        "stream_protocol": "whisper_live",
        "funasr_stream_url": "wss://asr.example/ws",
    }
    assert resolve_stream_driver(cfg) == "whisper_live"


@pytest.mark.asyncio
async def test_funasr_nano_ws_handle_message_emits() -> None:
    emitted: list[tuple[str, bool]] = []

    async def on_emit(text: str, is_final: bool) -> None:
        emitted.append((text, is_final))

    bridge = FunasrNanoWsStreamBridge(
        session_id="t",
        asr_cfg={"funasr_stream_url": "wss://example.test/ws", "model": "m"},
        on_emit=on_emit,
    )
    await bridge._handle_message({"event": "partial", "text": "partial"})
    await bridge._handle_message({"event": "transcript", "text": "final line"})
    assert emitted == [("partial", False), ("final line", True)]


@pytest.mark.asyncio
async def test_funasr_nano_ws_drops_ko_partial_hallucination() -> None:
    emitted: list[tuple[str, bool]] = []

    async def on_emit(text: str, is_final: bool) -> None:
        emitted.append((text, is_final))

    bridge = FunasrNanoWsStreamBridge(
        session_id="t",
        asr_cfg={"funasr_stream_url": "wss://example.test/ws", "model": "m"},
        on_emit=on_emit,
    )
    await bridge._handle_message(
        {"event": "partial", "text": "<|ko|><|NEUTRAL|><|Speech|><|woitn|>그"}
    )
    await bridge._handle_message(
        {"event": "partial", "text": "<|yue|><|NEUTRAL|>我想知道"}
    )
    assert emitted == [("我想知道", False)]


@pytest.mark.asyncio
async def test_funasr_runtime_handle_message_emits() -> None:
    emitted: list[tuple[str, bool]] = []

    async def on_emit(text: str, is_final: bool) -> None:
        emitted.append((text, is_final))

    bridge = FunasrRuntimeStreamBridge(
        session_id="t",
        asr_cfg={"funasr_stream_url": "wss://example.test/ws", "model": "m"},
        on_emit=on_emit,
    )
    await bridge._handle_message({"mode": "2pass-online", "text": "partial"})
    await bridge._handle_message({"mode": "2pass-offline", "text": "final line"})
    assert emitted == [("partial", False), ("final line", True)]
