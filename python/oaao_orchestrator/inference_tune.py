"""Per-turn inference sampling: baseline + bounded planner/heuristic deltas (UX-1 v2)."""

from __future__ import annotations

import re
from typing import Any

# Max single-turn adjustment per key (micro-tune, not replace).
_DELTA_CAPS: dict[str, tuple[float, float]] = {
    "temperature": (-0.12, 0.12),
    "top_p": (-0.08, 0.08),
    "top_k": (-24.0, 24.0),
    "presence_penalty": (-0.15, 0.15),
    "frequency_penalty": (-0.15, 0.15),
    "max_tokens": (-512.0, 768.0),
}

_BOUNDS: dict[str, tuple[float, float]] = {
    "temperature": (0.0, 2.0),
    "top_p": (0.0, 1.0),
    "top_k": (1.0, 200.0),
    "presence_penalty": (-2.0, 2.0),
    "frequency_penalty": (-2.0, 2.0),
    "max_tokens": (256.0, 8192.0),
}


def _clamp_key(key: str, value: float) -> float:
    lo, hi = _BOUNDS.get(key, (value, value))
    out = max(lo, min(hi, value))
    if key == "top_k" or key == "max_tokens":
        return float(int(round(out)))
    return round(out, 4) if key != "max_tokens" else out


def normalize_delta(raw: dict[str, Any] | None) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for key, (dlo, dhi) in _DELTA_CAPS.items():
        if key not in raw:
            continue
        try:
            v = float(raw[key])
        except (TypeError, ValueError):
            continue
        out[key] = max(dlo, min(dhi, v))
    return out


def apply_bounded_delta(
    baseline: dict[str, Any] | None,
    delta: dict[str, float] | None,
) -> dict[str, float]:
    """Apply deltas on top of baseline; keys not in baseline are seeded from defaults."""
    base: dict[str, float] = {}
    if isinstance(baseline, dict):
        for key in _BOUNDS:
            if key not in baseline:
                continue
            try:
                base[key] = float(baseline[key])
            except (TypeError, ValueError):
                continue
    if not base:
        base = {"temperature": 0.7, "top_p": 0.9}
    d = delta or {}
    out = dict(base)
    for key, step in d.items():
        if key not in _BOUNDS:
            continue
        cur = out.get(key, base.get(key, 0.0))
        out[key] = _clamp_key(key, cur + step)
    return {k: _clamp_key(k, v) for k, v in out.items()}


def heuristic_inference_delta(user_message: str) -> dict[str, float]:
    """Fallback when planner JSON omits inference_delta (stub planner / parse miss)."""
    text = (user_message or "").strip().lower()
    if not text:
        return {}
    delta: dict[str, float] = {}
    creative = re.search(
        r"\b(brainstorm|creative|story|poem|ideate|發想|創意|故事|詩|頭腦風暴)\b",
        text,
    )
    precise = re.search(
        r"\b(extract|json|csv|table|translate|翻譯|提取|列表|精確|准确|準確|bullet)\b",
        text,
    )
    long_form = re.search(
        r"\b(essay|report|long|detailed|詳細|長文|報告|深入)\b",
        text,
    )
    if creative:
        delta["temperature"] = 0.08
    if precise:
        delta["temperature"] = delta.get("temperature", 0.0) - 0.06
        delta["top_p"] = -0.05
        delta["presence_penalty"] = 0.05
    if long_form:
        delta["max_tokens"] = 384.0
    return normalize_delta(delta)


def resolve_turn_inference_delta(plan: object | None, user_message: str) -> dict[str, float]:
    raw = getattr(plan, "inference_delta", None)
    if isinstance(raw, dict) and raw:
        norm = normalize_delta(raw)
        if norm:
            return norm
    return heuristic_inference_delta(user_message)


def inference_mode_from_request(req: object) -> str:
    raw = getattr(req, "inference_mode", None)
    if raw is not None and str(raw).strip():
        return str(raw).strip().lower()
    return "off"


def apply_turn_inference_sampling(
    req: object,
    plan: object | None,
    *,
    user_message: str,
) -> dict[str, Any] | None:
    """
    For auto_tune runs: merge baseline (from PHP) + planner/heuristic delta into req.model_params.
    Returns snapshot dict for persistence when applied.
    """
    mode = inference_mode_from_request(req)
    if mode != "auto_tune":
        return None
    baseline = getattr(req, "model_params", None)
    if not isinstance(baseline, dict) or not baseline:
        baseline = getattr(req, "inference_baseline", None)
    if not isinstance(baseline, dict):
        baseline = {}
    delta = resolve_turn_inference_delta(plan, user_message)
    applied = apply_bounded_delta(baseline, delta)
    setattr(req, "model_params", applied)
    return {
        "mode": "auto_tune",
        "params_applied": applied,
        "baseline": dict(baseline) if isinstance(baseline, dict) else {},
        "delta": delta,
        "source": "auto_tune_planner_delta" if delta else "auto_tune_baseline",
    }
