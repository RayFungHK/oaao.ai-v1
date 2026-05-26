"""
Endpoint routing — tiered two-box LB (Phase 10, Audit §7.2).

``pick_base_url`` selects among ``base_urls[]`` using ``routing_policy``.
"""

from __future__ import annotations

import itertools
import os
import time
from typing import Any

_rr_cycle: itertools.cycle[str] | None = None
_health_cache: dict[str, tuple[float, bool]] = {}
_HEALTH_TTL = 5.0


def _is_healthy(url: str) -> bool:
    now = time.monotonic()
    cached = _health_cache.get(url)
    if cached and now - cached[0] < _HEALTH_TTL:
        return cached[1]
    disabled = os.environ.get("OAAO_BOX_HEALTH_CHECK", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    )
    if disabled:
        ok = True
    else:
        unhealthy = (os.environ.get("OAAO_UNHEALTHY_BOX_URLS") or "").strip()
        bad = {u.strip() for u in unhealthy.split(",") if u.strip()}
        ok = url not in bad
    _health_cache[url] = (now, ok)
    return ok


def _ctx_attr(ctx: Any, name: str, default: str = "") -> str:
    if ctx is None:
        return default
    val = getattr(ctx, name, None)
    if val is None and isinstance(ctx, dict):
        val = ctx.get(name)
    return str(val or default).strip().lower()


def pick_base_url(cfg: dict[str, Any], *, ctx: Any = None) -> str:
    urls_raw = cfg.get("base_urls") if isinstance(cfg, dict) else None
    if not isinstance(urls_raw, list) or not urls_raw:
        single = str(cfg.get("base_url") or "").strip() if isinstance(cfg, dict) else ""
        return single
    urls = [str(u).strip().rstrip("/") for u in urls_raw if str(u).strip()]
    if not urls:
        return ""
    if len(urls) == 1:
        return urls[0]

    policy = str(cfg.get("routing_policy") or "round_robin").strip().lower()
    planner_mode = _ctx_attr(ctx, "planner_mode_id", "")
    mode_id = planner_mode or _ctx_attr(ctx, "mode_id", "default")
    purpose_id = _ctx_attr(ctx, "purpose_id", "chat")

    preferred = urls[0]
    if policy == "tiered":
        if purpose_id in ("asr", "voice_chat", "rag", "vault_search", "document_qa", "embedding"):
            preferred = urls[-1]
        elif mode_id in ("tot", "ddtree"):
            preferred = urls[0]
        else:
            preferred = urls[-1]
    elif policy == "round_robin":
        global _rr_cycle
        if _rr_cycle is None:
            _rr_cycle = itertools.cycle(urls)
        preferred = next(_rr_cycle)

    if _is_healthy(preferred):
        return preferred
    for alt in urls:
        if alt != preferred and _is_healthy(alt):
            return alt
    return preferred


def maybe_downgrade_planner_mode(
    mode_id: str,
    cfg: dict[str, Any] | None,
) -> tuple[str, str | None]:
    """When Box 1 is unhealthy, downgrade heavy planner modes to ``default`` (Audit §7.2)."""
    mode = (mode_id or "default").strip().lower()
    if mode not in ("tot", "ddtree"):
        return mode, None
    if not isinstance(cfg, dict):
        return mode, None
    policy = str(cfg.get("routing_policy") or "").strip().lower()
    if policy != "tiered":
        return mode, None
    urls_raw = cfg.get("base_urls")
    if not isinstance(urls_raw, list) or len(urls_raw) < 2:
        return mode, None
    urls = [str(u).strip().rstrip("/") for u in urls_raw if str(u).strip()]
    if len(urls) < 2:
        return mode, None
    box1 = urls[0]
    if _is_healthy(box1):
        return mode, None
    if any(u != box1 and _is_healthy(u) for u in urls):
        return "default", f"{mode}->default"
    return mode, None
