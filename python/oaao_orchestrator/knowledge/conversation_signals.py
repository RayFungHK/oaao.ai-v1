"""Merge batch conversation topic signals into platform orientation (WS-1-S11)."""

from __future__ import annotations

import logging
import math
import time
from typing import Any

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.orientation_store import (
    load_orientation_platform,
    save_orientation,
)
from oaao_orchestrator.knowledge.topic_lifecycle import (
    TopicSignalV1,
    signals_from_orientation,
    topic_key_from_label,
)

logger = logging.getLogger(__name__)


def _importance_from_counts(mentions: int, hits: int) -> float:
    m = max(0, int(mentions))
    h = max(0, int(hits))
    return min(
        1.0,
        0.15 + (math.log1p(m) * 0.22) + (math.log1p(h) * 0.12),
    )


def merge_conversation_signal_batch(
    topics: list[dict[str, Any]],
    *,
    lookback_days: int | None = None,
) -> dict[str, Any]:
    """Upsert topic_signals on platform.json from PHP aggregator output."""
    orient = load_orientation_platform() or OrientationJsonV1(scope="platform")
    orient.scope = "platform"
    signals = signals_from_orientation(orient)
    merged_topics: list[str] = list(orient.topics[:24])
    updated = 0

    for row in topics:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or row.get("topic_key") or "").strip()
        key = str(row.get("topic_key") or "").strip() or topic_key_from_label(label)
        if not key:
            continue
        mentions = max(0, int(row.get("conversation_mentions") or 0))
        hits = max(0, int(row.get("keyword_hits") or 0))
        imp = float(row.get("importance_score") or 0.0)
        if imp <= 0:
            imp = _importance_from_counts(mentions, hits)

        sig = signals.get(key) or TopicSignalV1(topic_key=key, label=label[:200] or key)
        sig.conversation_mentions = max(sig.conversation_mentions, mentions)
        sig.keyword_hits = max(sig.keyword_hits, hits)
        sig.importance_score = max(sig.importance_score, min(1.0, imp))
        sig.updated_at = time.time()
        if lookback_days and lookback_days <= 14:
            sig.time_bounded = True
            sig.expires_after = time.time() + (float(lookback_days) * 86400.0)
        signals[key] = sig
        updated += 1

        if label and label not in merged_topics:
            merged_topics.append(label[:120])

    orient.topic_signals = {k: v.model_dump() for k, v in signals.items()}
    orient.topics = merged_topics[:24]
    if lookback_days and 1 <= lookback_days <= 90:
        orient.recency_days = lookback_days
    orient.updated_at = time.time()
    save_orientation(orient)

    logger.info(
        "conversation_signals merged count=%s lookback_days=%s",
        updated,
        lookback_days,
    )

    return {
        "ok": True,
        "updated": updated,
        "topic_signal_count": len(signals),
        "orientation": orient.model_dump(),
    }
