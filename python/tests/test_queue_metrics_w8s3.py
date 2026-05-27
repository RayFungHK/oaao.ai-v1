"""W8-S3 — queue metrics + kill-switch contract tests."""

from __future__ import annotations

from oaao_orchestrator.queue_metrics import effective_queue_backend_name, global_queue_metrics


def test_kill_switch_forces_memory_backend(monkeypatch) -> None:
    monkeypatch.setenv("OAAO_QUEUE_BACKEND", "redis")
    monkeypatch.setenv("OAAO_QUEUE_KILL_SWITCH", "1")
    assert effective_queue_backend_name() == "memory"


def test_xack_failure_counter_increments() -> None:
    metrics = global_queue_metrics()
    before = metrics.xack_failures
    metrics.note_xack_failure()
    assert metrics.xack_failures == before + 1
