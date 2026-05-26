"""W9-S1 — Profiling helpers for RAG / ASR / Slide hot paths.

A deliberately *small* timing surface that:

- never raises in the hot path (best-effort instrumentation),
- emits one structured log line per sample plus per-name aggregate stats
  (count / total_ms / p50_ms / p95_ms / max_ms),
- is opt-in via `OAAO_PROFILING_ENABLED=1` so production deployments pay no
  cost when disabled,
- exposes a snapshot dict for the `/v1/admin/profiling` route to surface
  to operators without pulling in OpenTelemetry/Prometheus yet.

Heavier instrumentation (OTel, Prometheus) lands in a later sprint; this
module is the bridge so existing call sites can adopt timing without
chaining `time.perf_counter()` everywhere.
"""

from __future__ import annotations

import bisect
import logging
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #


def profiling_enabled() -> bool:
    """True when OAAO_PROFILING_ENABLED=1."""
    return (os.environ.get("OAAO_PROFILING_ENABLED") or "").strip() == "1"


def _sample_cap() -> int:
    """Per-name sample ring size. 0 disables the ring (aggregate only)."""
    raw = (os.environ.get("OAAO_PROFILING_SAMPLE_CAP") or "").strip()
    if not raw:
        return 1024
    try:
        value = int(raw)
    except ValueError:
        return 1024
    return max(0, value)


# --------------------------------------------------------------------------- #
# Per-name aggregator
# --------------------------------------------------------------------------- #


@dataclass
class _Stats:
    count: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0
    samples_ms: list[float] = field(default_factory=list)

    def add(self, elapsed_ms: float, cap: int) -> None:
        self.count += 1
        self.total_ms += elapsed_ms
        if elapsed_ms > self.max_ms:
            self.max_ms = elapsed_ms
        if cap > 0:
            bisect.insort(self.samples_ms, elapsed_ms)
            if len(self.samples_ms) > cap:
                # drop oldest by trimming smallest *or* largest equally — keep
                # tail by popping a middling sample to preserve the percentile
                # shape. For simplicity, drop the median.
                mid = len(self.samples_ms) // 2
                del self.samples_ms[mid]

    def percentile(self, q: float) -> float:
        if not self.samples_ms:
            return 0.0
        if q <= 0:
            return self.samples_ms[0]
        if q >= 1:
            return self.samples_ms[-1]
        idx = round(q * (len(self.samples_ms) - 1))
        return self.samples_ms[idx]

    def snapshot(self) -> dict[str, float]:
        return {
            "count": float(self.count),
            "total_ms": round(self.total_ms, 3),
            "avg_ms": round(self.total_ms / self.count, 3) if self.count else 0.0,
            "p50_ms": round(self.percentile(0.50), 3),
            "p95_ms": round(self.percentile(0.95), 3),
            "max_ms": round(self.max_ms, 3),
        }


_lock = threading.Lock()
_stats: dict[str, _Stats] = {}


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def record(name: str, elapsed_ms: float) -> None:
    """Record a single sample under `name`. Safe to call when disabled."""
    if not profiling_enabled():
        return
    cap = _sample_cap()
    with _lock:
        st = _stats.setdefault(name, _Stats())
        st.add(elapsed_ms, cap)
    logger.debug("profiling: %s elapsed_ms=%.3f", name, elapsed_ms)


@contextmanager
def hot_path_timer(name: str, *, extra: dict[str, Any] | None = None) -> Iterator[None]:
    """Context manager — records elapsed wall time under `name`.

    Always yields; exceptions inside the block do **not** suppress the
    timing record (the sample is still added before the exception
    propagates). Use for narrow hot paths (RAG retrieval, ASR window,
    slide render) where you want p50/p95 visibility.
    """
    if not profiling_enabled():
        yield
        return
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        record(name, elapsed_ms)
        if extra:
            logger.debug("profiling: %s extra=%s", name, extra)


def snapshot() -> dict[str, dict[str, float]]:
    """Return per-name aggregate stats. Safe even when profiling disabled."""
    with _lock:
        return {name: st.snapshot() for name, st in _stats.items()}


def reset() -> None:
    """Clear all aggregates. Primarily for tests."""
    with _lock:
        _stats.clear()
