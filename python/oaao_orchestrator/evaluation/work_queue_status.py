"""Aggregate in-process background queue snapshots for admin Settings."""

from __future__ import annotations

import time
from typing import Any

from oaao_orchestrator.evaluation import turn_score_backfill
from oaao_orchestrator.evaluation.post_stream_worker import evolution_post_stream_enabled
from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload
from oaao_orchestrator.post_stream_pool import post_stream_pools


def work_queues_status_payload() -> dict[str, Any]:
    rescore_rows: list[dict[str, Any]] = []
    for cid in sorted(turn_score_backfill._inflight):
        meta = turn_score_backfill._inflight_meta.get(cid) or {}
        rescore_rows.append(
            {
                "conversation_id": cid,
                "turn_count": int(meta.get("turn_count") or 0),
                "started_at": float(meta.get("started_at") or 0),
            }
        )

    pool_rows: list[dict[str, Any]] = []
    for pool in post_stream_pools():
        pool_rows.append(
            {
                "pool_id": pool.settings.pool_id,
                "queue_depth": pool.queue_depth(),
                "worker_count": pool.worker_count(),
                "plugins": list(pool.settings.plugins_after_stream or []),
            }
        )

    return {
        "scorer_versions": scorer_versions_payload(),
        "evolution_post_stream_enabled": evolution_post_stream_enabled(),
        "turn_score_rescore": {
            "active_count": len(rescore_rows),
            "active": rescore_rows,
        },
        "post_stream_pools": pool_rows,
        "generated_at": time.time(),
    }
