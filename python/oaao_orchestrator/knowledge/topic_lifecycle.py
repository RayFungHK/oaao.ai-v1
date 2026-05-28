"""Platform Knowledge topic scoring and auto-search lifecycle (WS-1-S10)."""

from __future__ import annotations

import os
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

TopicLifecycleStatus = Literal[
    "active",
    "paused_low_yield",
    "paused_stale",
    "paused_outdated",
]


class TopicSignalV1(BaseModel):
    """Per-topic platform evolution signal — drives auto web search inclusion."""

    topic_key: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=200)
    importance_score: float = Field(default=0.0, ge=0.0, le=1.0)
    conversation_mentions: int = Field(default=0, ge=0)
    keyword_hits: int = Field(default=0, ge=0)
    search_runs: int = Field(default=0, ge=0)
    last_search_at: float = Field(default=0.0, ge=0.0)
    last_new_hits: int = Field(default=0, ge=0)
    cumulative_hits: int = Field(default=0, ge=0)
    yield_density: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Fraction of recent searches that added non-duplicate value.",
    )
    topicality_score: float = Field(default=1.0, ge=0.0, le=1.0)
    time_bounded: bool = False
    expires_after: float | None = Field(default=None, ge=0.0)
    status: TopicLifecycleStatus = "active"
    breakthrough_links: list[str] = Field(default_factory=list, max_length=12)
    updated_at: float = Field(default_factory=time.time)


def refresh_scopes_mode() -> str:
    """platform (default) | all — cron discovers tenant_* only when all."""
    raw = (os.environ.get("OAAO_KNOWLEDGE_REFRESH_SCOPES") or "platform").strip().lower()
    return raw if raw in ("platform", "all") else "platform"


def importance_gate() -> float:
    raw = (os.environ.get("OAAO_KNOWLEDGE_TOPIC_IMPORTANCE_MIN") or "0.35").strip()
    try:
        return max(0.0, min(1.0, float(raw)))
    except ValueError:
        return 0.35


def low_yield_pause_after() -> int:
    raw = (os.environ.get("OAAO_KNOWLEDGE_TOPIC_LOW_YIELD_RUNS") or "3").strip()
    try:
        return max(2, min(12, int(raw)))
    except ValueError:
        return 3


def topicality_decay_min() -> float:
    raw = (os.environ.get("OAAO_KNOWLEDGE_TOPIC_TOPICALITY_MIN") or "0.25").strip()
    try:
        return max(0.05, min(1.0, float(raw)))
    except ValueError:
        return 0.25


_NON_WORD = re.compile(r"[^\w\u4e00-\u9fff]+", re.UNICODE)


def topic_key_from_label(label: str) -> str:
    t = (label or "").strip().lower()
    if not t:
        return ""
    t = _NON_WORD.sub(" ", t)
    parts = [p for p in t.split() if p][:8]
    return "-".join(parts)[:120] or t[:120]


def signals_from_orientation(orientation: Any) -> dict[str, TopicSignalV1]:
    raw = getattr(orientation, "topic_signals", None)
    if not isinstance(raw, dict):
        return {}
    out: dict[str, TopicSignalV1] = {}
    for key, row in raw.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if isinstance(row, TopicSignalV1):
            out[key.strip()] = row
        elif isinstance(row, dict):
            try:
                sig = TopicSignalV1.model_validate({**row, "topic_key": key.strip()})
                out[sig.topic_key] = sig
            except Exception:
                continue
    return out


def rank_topics_for_importance(
    orientation: Any,
    *,
    cap: int = 24,
) -> list[tuple[str, float]]:
    """Derive importance from orientation topics + suggested queries (platform aggregate)."""
    topics = list(getattr(orientation, "topics", None) or [])[:cap]
    queries = list(getattr(orientation, "search_queries_suggested", None) or [])[:cap]
    signals = signals_from_orientation(orientation)
    ranked: dict[str, float] = {}

    for key, sig in signals.items():
        if sig.importance_score > 0:
            ranked[key] = max(ranked.get(key, 0.0), min(1.0, sig.importance_score))

    for idx, topic in enumerate(topics):
        label = str(topic or "").strip()
        if not label:
            continue
        key = topic_key_from_label(label)
        if not key:
            continue
        base = max(0.2, 1.0 - (idx * 0.04))
        sig = signals.get(key)
        if sig is not None:
            base = max(base, sig.importance_score)
            base += min(0.15, sig.conversation_mentions * 0.02)
            base += min(0.1, sig.keyword_hits * 0.01)
        ranked[key] = max(ranked.get(key, 0.0), min(1.0, base))

    for idx, query in enumerate(queries):
        label = str(query or "").strip()
        if not label:
            continue
        key = topic_key_from_label(label)
        if not key:
            continue
        boost = max(0.35, 0.85 - (idx * 0.05))
        ranked[key] = max(ranked.get(key, 0.0), min(1.0, boost))

    return sorted(ranked.items(), key=lambda x: x[1], reverse=True)


def should_include_topic_in_auto_search(
    signal: TopicSignalV1 | None,
    *,
    importance: float,
) -> tuple[bool, str]:
    if importance < importance_gate():
        return False, "importance_below_gate"
    if signal is None:
        return True, "new_topic"
    if signal.status != "active":
        if signal.breakthrough_links:
            return True, "breakthrough_linked"
        return False, signal.status
    if signal.time_bounded and signal.expires_after and time.time() > signal.expires_after:
        return False, "paused_outdated"
    if signal.topicality_score < topicality_decay_min():
        return False, "paused_stale"
    if (
        signal.search_runs >= low_yield_pause_after()
        and signal.yield_density < 0.12
        and signal.last_new_hits < 1
    ):
        return False, "paused_low_yield"
    return True, "active"


def filter_scheduled_queries(
    queries: list[dict[str, Any]],
    orientation: Any | None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Gate cron / scheduled queries by platform topic importance + lifecycle."""
    if orientation is None:
        return queries, []
    signals = signals_from_orientation(orientation)
    importance_map = dict(rank_topics_for_importance(orientation))
    kept: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for row in queries:
        q = str(row.get("q") or "").strip()
        if not q:
            continue
        key = topic_key_from_label(q)
        imp = importance_map.get(key, 0.5)
        ok, reason = should_include_topic_in_auto_search(signals.get(key), importance=imp)
        if ok:
            kept.append(row)
        else:
            skipped.append({"q": q[:120], "reason": reason})
    return kept, skipped


def record_search_outcome(
    orientation: Any,
    *,
    query: str,
    hits_count: int,
    new_content_ratio: float,
) -> dict[str, TopicSignalV1]:
    """Update topic_signals on orientation after a refresh run (mutates dict in-place)."""
    key = topic_key_from_label(query)
    if not key:
        return signals_from_orientation(orientation)

    signals = signals_from_orientation(orientation)
    sig = signals.get(key) or TopicSignalV1(topic_key=key, label=query[:200])
    sig.search_runs += 1
    sig.last_search_at = time.time()
    sig.last_new_hits = max(0, int(hits_count))
    sig.cumulative_hits += sig.last_new_hits
    ratio = max(0.0, min(1.0, float(new_content_ratio)))
    if sig.search_runs <= 1:
        sig.yield_density = ratio
    else:
        sig.yield_density = (sig.yield_density * 0.6) + (ratio * 0.4)
    if hits_count < 1:
        sig.topicality_score = max(0.0, sig.topicality_score - 0.08)
    elif ratio < 0.15 and sig.search_runs >= low_yield_pause_after():
        sig.status = "paused_low_yield"
    elif sig.topicality_score < topicality_decay_min():
        sig.status = "paused_stale"
    elif sig.time_bounded and sig.expires_after and time.time() > sig.expires_after:
        sig.status = "paused_outdated"
    else:
        sig.status = "active"
    sig.updated_at = time.time()
    signals[key] = sig

    if hasattr(orientation, "topic_signals"):
        orientation.topic_signals = {k: v.model_dump() for k, v in signals.items()}
    return signals
