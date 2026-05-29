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

import json
import logging
import os
import re
from typing import Any

import httpx

_RE_UPSTREAM_CONTEXT_LEN = re.compile(
    r"maximum context length is (\d+)",
    re.IGNORECASE,
)
_RE_UPSTREAM_INPUT_TOKENS = re.compile(
    r"input_tokens.*?value[=:]?\s*(\d+)",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)

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


def estimate_text_tokens(text: str) -> int:
    """Conservative chars→tokens heuristic (CJK-friendly)."""
    if not text:
        return 0
    return max(1, (len(text) + 1) // 2)


def estimate_messages_tokens(messages: list[Any]) -> int:
    """Rough prompt size for context budgeting before upstream call."""
    total = 0
    n_msgs = 0
    for row in messages:
        if not isinstance(row, dict):
            continue
        n_msgs += 1
        content = row.get("content")
        if isinstance(content, str):
            total += estimate_text_tokens(content)
            continue
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    total += estimate_text_tokens(part["text"])
                elif part.get("type") == "image_url":
                    total += 512
    # Conservative margin — underestimating prompt size causes context 400s.
    overhead = 48 * max(1, n_msgs)
    return max(1, int(total * 1.2) + overhead)


def prompt_tokens_for_budget(messages: list[Any], body: dict[str, Any]) -> int:
    prompt_est = estimate_messages_tokens(messages)
    tools = body.get("tools")
    if isinstance(tools, list) and tools:
        try:
            prompt_est += min(8000, max(200, len(json.dumps(tools, ensure_ascii=False)) // 3))
        except (TypeError, ValueError):
            prompt_est += 400 * len(tools)
    return prompt_est


def fallback_context_len() -> int:
    """When endpoint config lacks ``max_model_len`` (not probed in Settings)."""
    raw = os.environ.get("OAAO_CHAT_FALLBACK_CONTEXT_LEN", "16384").strip()
    if raw in ("0", "false", "no", "off"):
        return 0
    try:
        return max(256, min(int(raw), 131_072))
    except ValueError:
        return 16_384


def parse_upstream_context_limit_from_text(error_text: str) -> int | None:
    if not error_text:
        return None
    m = _RE_UPSTREAM_CONTEXT_LEN.search(error_text)
    if not m:
        return None
    try:
        return max(256, min(int(m.group(1)), 131_072))
    except (TypeError, ValueError):
        return None


def parse_upstream_input_tokens_from_text(error_text: str) -> int | None:
    if not error_text:
        return None
    m = _RE_UPSTREAM_INPUT_TOKENS.search(error_text)
    if not m:
        return None
    try:
        return max(0, int(m.group(1)))
    except (TypeError, ValueError):
        return None


def is_upstream_context_length_error(status: int, error_text: str) -> bool:
    if status != 400:
        return False
    low = error_text.lower()
    return (
        "context length" in low
        or "input_tokens" in low
        or "maximum context" in low
    )


def resolve_effective_context_len(
    req: Any,
    *,
    prompt_tokens: int,
    desired_output: int | None,
) -> int | None:
    ctx = resolve_endpoint_context_len(req)
    if ctx is not None:
        return ctx
    fb = fallback_context_len()
    if fb <= 0:
        return None
    out = desired_output if isinstance(desired_output, int) and desired_output > 0 else 0
    if prompt_tokens + out > fb - context_reserve_tokens():
        return fb
    return None


def resolve_endpoint_context_len(req: Any) -> int | None:
    """``max_model_len`` from PHP-forwarded endpoint ``config`` (Settings probe)."""
    ep = getattr(req, "endpoint", None)
    cfg = getattr(ep, "config", None) if ep is not None else None
    if not isinstance(cfg, dict):
        return None
    for key in ("max_model_len", "max_context_tokens", "context_length"):
        raw = cfg.get(key)
        if raw is None:
            continue
        try:
            n = int(raw)
        except (TypeError, ValueError):
            continue
        if n > 0:
            return max(256, min(n, 131_072))
    return None


def context_reserve_tokens() -> int:
    try:
        return max(32, min(4096, int(os.environ.get("OAAO_CHAT_CONTEXT_RESERVE_TOKENS", "256"))))
    except ValueError:
        return 256


def cap_max_tokens_for_context(
    *,
    desired: int | None,
    context_len: int | None,
    prompt_tokens: int,
    reserve: int | None = None,
    min_output: int = 64,
) -> int | None:
    """``max_tokens <= context_len - prompt - reserve`` to avoid upstream 400."""
    if desired is None or desired <= 0:
        return None
    if context_len is None or context_len <= 0:
        return min(desired, 128_000)
    margin = reserve if reserve is not None else context_reserve_tokens()
    budget = int(context_len) - max(0, int(prompt_tokens)) - margin
    if budget < min_output:
        budget = min_output
    return max(min_output, min(int(desired), budget))


def shrink_max_tokens_for_context_error(
    body: dict[str, Any],
    req: Any,
    messages: list[Any],
    error_text: str,
) -> bool:
    """After upstream 400, lower ``max_tokens`` using error-reported limits. Returns True if changed."""
    desired = body.get("max_tokens")
    if not isinstance(desired, int) or desired <= 0:
        desired = resolve_max_tokens(req)
    if desired is None:
        return False

    prompt_est = prompt_tokens_for_budget(messages, body)
    reported_in = parse_upstream_input_tokens_from_text(error_text)
    if reported_in is not None:
        prompt_est = max(prompt_est, reported_in)

    context_len = (
        parse_upstream_context_limit_from_text(error_text)
        or resolve_endpoint_context_len(req)
        or fallback_context_len()
    )
    if context_len <= 0:
        return False

    capped = cap_max_tokens_for_context(
        desired=desired,
        context_len=context_len,
        prompt_tokens=prompt_est,
    )
    if capped is None:
        return False
    if capped >= desired:
        capped = max(64, desired // 2)
    if capped >= desired:
        return False

    body["max_tokens"] = capped
    logger.info(
        "chat_max_tokens_shrunk_after_400 desired=%s capped=%s prompt_est=%s context=%s",
        desired,
        capped,
        prompt_est,
        context_len,
    )
    return True


def finalize_max_tokens_for_upstream(
    body: dict[str, Any],
    req: Any,
    messages: list[Any],
) -> None:
    """Apply resolved/capped ``max_tokens`` after model_params merge."""
    desired = body.get("max_tokens")
    if not isinstance(desired, int) or desired <= 0:
        desired = resolve_max_tokens(req)
    if desired is None:
        body.pop("max_tokens", None)
        return

    prompt_est = prompt_tokens_for_budget(messages, body)
    context_len = resolve_effective_context_len(
        req,
        prompt_tokens=prompt_est,
        desired_output=desired,
    )
    if context_len is None:
        body["max_tokens"] = min(desired, 128_000)
        return

    capped = cap_max_tokens_for_context(
        desired=desired,
        context_len=context_len,
        prompt_tokens=prompt_est,
    )
    if capped is None:
        body.pop("max_tokens", None)
        return
    if capped < desired:
        logger.info(
            "chat_max_tokens_capped desired=%s capped=%s prompt_est=%s context=%s",
            desired,
            capped,
            prompt_est,
            context_len,
        )
    body["max_tokens"] = capped


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
