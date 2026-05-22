from __future__ import annotations

import pytest

from oaao_orchestrator.live_meeting.dashscope_asr_stream import (
    DashscopeRealtimeAsrBridge,
    is_qwen_realtime_model,
    resolve_dashscope_ws_url,
)
from oaao_orchestrator.live_meeting.qwen_asr_stream import (
    is_streaming_asr_mode,
    use_dashscope_realtime_stream,
)


def test_is_qwen_realtime_model() -> None:
    assert is_qwen_realtime_model("qwen3-asr-flash-realtime")
    assert not is_qwen_realtime_model("fun-asr-realtime")


def test_resolve_ws_urls() -> None:
    url, proto = resolve_dashscope_ws_url({"model": "fun-asr-realtime", "dashscope_region": "intl"})
    assert proto == "funasr"
    assert "inference" in url
    url2, proto2 = resolve_dashscope_ws_url({"model": "qwen3-asr-flash-realtime"})
    assert proto2 == "qwen"
    assert "realtime" in url2


@pytest.mark.asyncio
async def test_funasr_result_generated_parsing() -> None:
    emitted: list[tuple[str, bool]] = []

    async def on_emit(text: str, is_final: bool) -> None:
        emitted.append((text, is_final))

    bridge = DashscopeRealtimeAsrBridge(session_id="t", asr_cfg={"model": "fun-asr-realtime"}, on_emit=on_emit)
    bridge._protocol = "funasr"
    await bridge._handle_message(
        {
            "header": {"event": "result-generated"},
            "payload": {
                "output": {
                    "sentence": {"text": "你好", "sentence_end": False},
                }
            },
        }
    )
    await bridge._handle_message(
        {
            "header": {"event": "result-generated"},
            "payload": {
                "output": {
                    "sentence": {"text": "你好世界", "sentence_end": True},
                }
            },
        }
    )
    assert emitted == [("你好", False), ("你好世界", True)]


def test_use_dashscope_streaming_flag() -> None:
    cfg = {"mode": "streaming", "model": "qwen3-asr-flash-realtime"}
    assert is_streaming_asr_mode(cfg)
    assert use_dashscope_realtime_stream(cfg)
