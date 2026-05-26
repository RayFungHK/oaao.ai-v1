from __future__ import annotations

from oaao_orchestrator.asr_common import (
    BATCH_PROTOCOL_JSON,
    BATCH_PROTOCOL_OPENAI,
    has_batch_transcribe_config,
    json_transcribe_url,
    resolve_batch_http_base,
    resolve_batch_protocol,
)
from oaao_orchestrator.live_meeting.qwen_asr_stream import segment_transcribe_asr_cfg


def test_resolve_batch_protocol_openai_default() -> None:
    assert (
        resolve_batch_protocol({"provider": "openai_compat", "base_url": "http://qwen.test"})
        == BATCH_PROTOCOL_OPENAI
    )


def test_resolve_batch_protocol_json_explicit() -> None:
    assert resolve_batch_protocol({"batch_protocol": "json_transcribe"}) == BATCH_PROTOCOL_JSON


def test_resolve_batch_protocol_json_legacy_provider() -> None:
    assert resolve_batch_protocol({"provider": "funasr_nano"}) == BATCH_PROTOCOL_JSON


def test_resolve_batch_http_base_skips_ws() -> None:
    cfg = {
        "base_url": "wss://stream.test/ws",
        "funasr_base_url": "https://batch.test",
    }
    assert resolve_batch_http_base(cfg) == "https://batch.test"


def test_json_transcribe_url() -> None:
    assert json_transcribe_url("https://funasr-nano.test") == "https://funasr-nano.test/transcribe"


def test_segment_transcribe_prefers_asr_slot() -> None:
    live = {
        "provider": "dashscope",
        "mode": "streaming",
        "funasr_stream_url": "wss://dashscope.test/ws",
        "funasr_base_url": "https://funasr-nano.test",
    }
    batch = {
        "provider": "openai_compat",
        "base_url": "http://qwen3-asr.test",
        "model": "Qwen/Qwen3-ASR-1.7B",
    }
    picked = segment_transcribe_asr_cfg(live, batch)
    assert picked is batch
    assert has_batch_transcribe_config(picked)


def test_segment_transcribe_live_only() -> None:
    live = {"provider": "openai_compat", "base_url": "http://qwen.test", "model": "m"}
    picked = segment_transcribe_asr_cfg(live, None)
    assert picked is live
