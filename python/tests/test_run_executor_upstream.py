"""W5-S2 — Contract tests for run_executor_upstream split."""

from __future__ import annotations

import httpx
import pytest
from oaao_orchestrator.run_executor_upstream import (
    LLM_STREAM_READ_TIMEOUT_SEC,
    apply_upstream_sampling,
    cap_max_tokens_for_context,
    estimate_messages_tokens,
    finalize_max_tokens_for_upstream,
    is_upstream_context_length_error,
    llm_stream_timeout,
    parse_upstream_context_limit_from_text,
    resolve_max_tokens,
    shrink_max_tokens_for_context_error,
)


class _Req:
    def __init__(self, max_tokens=None, endpoint=None):
        self.max_tokens = max_tokens
        self.endpoint = endpoint


class _Ep:
    def __init__(self, config=None):
        self.config = config


def test_resolve_max_tokens_from_request():
    assert resolve_max_tokens(_Req(max_tokens=512)) == 512


def test_resolve_max_tokens_clamps_to_ceiling():
    assert resolve_max_tokens(_Req(max_tokens=10_000_000)) == 128_000


def test_resolve_max_tokens_ignores_invalid_request_field():
    assert resolve_max_tokens(_Req(max_tokens=0)) is None
    assert resolve_max_tokens(_Req(max_tokens=-1)) is None


def test_resolve_max_tokens_from_env(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_MAX_TOKENS", "256")
    assert resolve_max_tokens(_Req()) == 256


def test_resolve_max_tokens_env_invalid_returns_none(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_MAX_TOKENS", "nope")
    assert resolve_max_tokens(_Req()) is None


def test_resolve_max_tokens_default_is_none(monkeypatch):
    monkeypatch.delenv("OAAO_CHAT_MAX_TOKENS", raising=False)
    assert resolve_max_tokens(_Req()) is None


def test_apply_upstream_sampling_no_env_no_mutation(monkeypatch):
    for var in (
        "OAAO_CHAT_REPETITION_PENALTY",
        "OAAO_CHAT_TOP_P",
        "OAAO_CHAT_FREQUENCY_PENALTY",
        "OAAO_CHAT_PRESENCE_PENALTY",
    ):
        monkeypatch.delenv(var, raising=False)
    body: dict = {"messages": []}
    apply_upstream_sampling(body)
    assert body == {"messages": []}


def test_apply_upstream_sampling_repetition_penalty(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_REPETITION_PENALTY", "1.1")
    body: dict = {}
    apply_upstream_sampling(body)
    assert body["repetition_penalty"] == pytest.approx(1.1)


def test_apply_upstream_sampling_clamps_top_p(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_TOP_P", "5.0")
    body: dict = {}
    apply_upstream_sampling(body)
    assert body["top_p"] == 1.0


def test_apply_upstream_sampling_invalid_value_skipped(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_TOP_P", "not-a-number")
    body: dict = {}
    apply_upstream_sampling(body)
    assert "top_p" not in body


def test_llm_stream_timeout_profile():
    t = llm_stream_timeout()
    assert isinstance(t, httpx.Timeout)
    assert t.read == LLM_STREAM_READ_TIMEOUT_SEC
    assert t.connect == 15.0


def test_cap_max_tokens_for_context_clamps_to_budget():
    # 16384 ctx, ~8193 prompt, reserve 256 → budget 7835
    capped = cap_max_tokens_for_context(
        desired=8192,
        context_len=16384,
        prompt_tokens=8193,
        reserve=256,
    )
    assert capped == 7835


def test_cap_max_tokens_for_context_skips_without_context_len():
    assert cap_max_tokens_for_context(desired=8192, context_len=None, prompt_tokens=9000) == 8192


def test_finalize_max_tokens_for_upstream_caps_body():
    req = _Req(max_tokens=8192, endpoint=_Ep({"max_model_len": 16384}))
    body: dict = {"max_tokens": 8192}
    messages = [{"role": "user", "content": "x" * 16386}]
    finalize_max_tokens_for_upstream(body, req, messages)
    assert isinstance(body.get("max_tokens"), int)
    assert body["max_tokens"] < 8192


def test_estimate_messages_tokens_multimodal_text():
    msgs = [{"role": "user", "content": [{"type": "text", "text": "hello"}]}]
    assert estimate_messages_tokens(msgs) >= 1


def test_parse_upstream_context_limit_from_text():
    raw = (
        'maximum context length is 16384 tokens. However, you requested 8192 '
        'output tokens and your prompt contains at least 8193 input tokens'
    )
    assert parse_upstream_context_limit_from_text(raw) == 16384
    assert is_upstream_context_length_error(400, raw) is True


def test_shrink_max_tokens_for_context_error():
    err = (
        '{"error":{"message":"maximum context length is 16384 tokens. '
        'input_tokens, value=8193"}}'
    )
    body = {"max_tokens": 8192}
    req = _Req(max_tokens=8192, endpoint=_Ep({"max_model_len": 16384}))
    msgs = [{"role": "user", "content": "x" * 1000}]
    assert shrink_max_tokens_for_context_error(body, req, msgs, err) is True
    assert body["max_tokens"] < 8192


def test_finalize_uses_fallback_when_prompt_large(monkeypatch):
    monkeypatch.setenv("OAAO_CHAT_FALLBACK_CONTEXT_LEN", "16384")
    req = _Req(max_tokens=8192, endpoint=_Ep({}))
    body: dict = {"max_tokens": 8192}
    messages = [{"role": "user", "content": "x" * 12000}]
    finalize_max_tokens_for_upstream(body, req, messages)
    assert body["max_tokens"] < 8192
