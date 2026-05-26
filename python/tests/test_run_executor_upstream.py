"""W5-S2 — Contract tests for run_executor_upstream split."""

from __future__ import annotations

import httpx
import pytest
from oaao_orchestrator.run_executor_upstream import (
    LLM_STREAM_READ_TIMEOUT_SEC,
    apply_upstream_sampling,
    llm_stream_timeout,
    resolve_max_tokens,
)


class _Req:
    def __init__(self, max_tokens=None):
        self.max_tokens = max_tokens


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
