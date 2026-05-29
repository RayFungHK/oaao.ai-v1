"""W5-S2 (phase 1) — Upstream LLM sampling + timeout helpers extracted from
`run_executor.py`.

This module is intentionally narrow: pure functions, no domain imports, no
side effects beyond reading `os.environ`. The goal of phase 1 is to prove the
split pattern (one-way dependency from `run_executor` into this module) and
reduce `run_executor.py` LOC by a measurable amount without changing any
observable behaviour.

Phase 2 will extract the pipeline-timing cluster (`_record_pipeline_*`,
`_finalize_run_task_timing`) and phase 3 the plan-introspection cluster.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

LLM_STREAM_READ_TIMEOUT_SEC = 900.0


def resolve_max_tokens(req: Any) -> int | None:
    """Effective max_tokens for upstream chat/completions.

    Priority: request body > `OAAO_CHAT_MAX_TOKENS` env > None.
    Always clamped to [1, 128_000].
    """
    mt = getattr(req, "max_tokens", None)
    if isinstance(mt, int) and mt > 0:
        return min(mt, 128_000)
    raw = os.environ.get("OAAO_CHAT_MAX_TOKENS", "").strip()
    if not raw:
        return None
    try:
        return min(max(1, int(raw)), 128_000)
    except ValueError:
        return None


def apply_model_params_from_request(body: dict[str, Any], req: Any) -> None:
    """Merge UX-1 model_params from PHP onto upstream chat/completions body."""
    raw = getattr(req, "model_params", None)
    if not isinstance(raw, dict) or not raw:
        return
    if "temperature" in raw:
        try:
            body["temperature"] = max(0.0, min(2.0, float(raw["temperature"])))
        except (TypeError, ValueError):
            pass
    if "max_tokens" in raw:
        try:
            mt = int(raw["max_tokens"])
            if mt > 0:
                body["max_tokens"] = min(mt, 128_000)
        except (TypeError, ValueError):
            pass
    for key, lo, hi in (
        ("top_p", 0.0, 1.0),
        ("frequency_penalty", -2.0, 2.0),
        ("presence_penalty", -2.0, 2.0),
    ):
        if key not in raw:
            continue
        try:
            body[key] = max(lo, min(hi, float(raw[key])))
        except (TypeError, ValueError):
            continue
    top_k = raw.get("top_k")
    if top_k is not None:
        try:
            body["top_k"] = max(1, min(200, int(top_k)))
        except (TypeError, ValueError):
            pass


def apply_upstream_sampling(body: dict[str, Any]) -> None:
    """Optional OpenAI/vLLM sampling overrides from env vars.

    Reduces repetition collapse on large models. Mutates `body` in place;
    leaves it untouched if no env vars are set.
    """
    rp = os.environ.get("OAAO_CHAT_REPETITION_PENALTY", "").strip()
    if rp:
        try:
            v = float(rp)
            if v > 0:
                body["repetition_penalty"] = v
        except ValueError:
            pass
    for key, env_key, lo, hi in (
        ("top_p", "OAAO_CHAT_TOP_P", 0.0, 1.0),
        ("frequency_penalty", "OAAO_CHAT_FREQUENCY_PENALTY", -2.0, 2.0),
        ("presence_penalty", "OAAO_CHAT_PRESENCE_PENALTY", -2.0, 2.0),
    ):
        raw = os.environ.get(env_key, "").strip()
        if not raw:
            continue
        try:
            body[key] = max(lo, min(hi, float(raw)))
        except ValueError:
            continue


def llm_stream_timeout() -> httpx.Timeout:
    """Default httpx timeout profile for the upstream LLM streaming call."""
    return httpx.Timeout(
        connect=15.0,
        read=LLM_STREAM_READ_TIMEOUT_SEC,
        write=60.0,
        pool=30.0,
    )
