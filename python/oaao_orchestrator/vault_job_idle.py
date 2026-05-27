"""Adaptive idle sleep for vault job workers — reduces empty-queue poll churn."""

from __future__ import annotations


def vault_job_idle_sleep_seconds(
    *,
    empty_streak: int,
    base_interval: float,
    cap: float | None = None,
) -> float:
    """Exponential backoff when claim returns empty; reset streak after a job."""
    if empty_streak <= 0:
        return 0.2
    base = max(0.1, float(base_interval))
    ceiling = float(cap if cap is not None else max(base, base * 4.0))
    factor = min(max(empty_streak - 1, 0), 6)
    return min(ceiling, base * (0.5 * (2**factor)))
