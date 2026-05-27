"""W8-S3 — Queue backend metrics + kill-switch helpers."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any


def effective_queue_backend_name() -> str:
    """Runtime backend selection — honours kill-switch."""
    kill = (os.environ.get("OAAO_QUEUE_KILL_SWITCH") or "").strip().lower()
    if kill in ("1", "true", "yes", "on"):
        return "memory"
    return (os.environ.get("OAAO_QUEUE_BACKEND") or "memory").strip().lower() or "memory"


@dataclass
class QueueMetricsSnapshot:
    backend: str = "memory"
    queue_depth: int = 0
    oldest_pending_age_sec: float | None = None
    xack_failures: int = 0
    pending_count: int = 0

    def as_dict(self, *, pool_id: str) -> dict[str, Any]:
        return {
            "pool_id": pool_id,
            "backend": self.backend,
            "queue_depth": self.queue_depth,
            "pending_count": self.pending_count,
            "oldest_pending_age_sec": self.oldest_pending_age_sec,
            "xack_failures": self.xack_failures,
            "generated_at": time.time(),
        }


@dataclass
class _MetricsCollector:
    xack_failures: int = 0
    pending_oldest_ms: float | None = None

    def note_xack_failure(self) -> None:
        self.xack_failures += 1

    def snapshot(self, *, backend: str, queue_depth: int, pending_count: int = 0) -> QueueMetricsSnapshot:
        age: float | None = None
        if self.pending_oldest_ms is not None and self.pending_oldest_ms > 0:
            age = max(0.0, (time.time() * 1000 - self.pending_oldest_ms) / 1000.0)
        return QueueMetricsSnapshot(
            backend=backend,
            queue_depth=queue_depth,
            oldest_pending_age_sec=age,
            xack_failures=self.xack_failures,
            pending_count=pending_count,
        )


_global_metrics = _MetricsCollector()


def global_queue_metrics() -> _MetricsCollector:
    return _global_metrics
