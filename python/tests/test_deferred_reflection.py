"""Deferred ACCS reflection — next-turn inject + post-stream reasons."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.evaluation.accs import ACCSResult
from oaao_orchestrator.evaluation.accs_reflection_inject import apply_accs_reflection_context
from oaao_orchestrator.evaluation.deferred_reflection import (
    build_accs_reflection_system_block,
    build_deferred_reflection_reasons,
)


def test_build_deferred_reflection_reasons_reflect_action() -> None:
    accs = ACCSResult(
        score=0.52,
        factors={"alignment": 0.5, "accuracy": 0.55, "hallucination": 0.12},
        action="reflect",
    )
    reasons = build_deferred_reflection_reasons(accs)
    assert reasons["reflection_deferred"] is True
    assert reasons["reflection_pending_next_turn"] is True
    assert reasons["reflection_consumed"] is False
    assert "improvement" in reasons["reflection_critique"].lower()
    assert reasons["reflection_initial_score"] == 0.52


def test_apply_accs_reflection_injects_system_message() -> None:
    req = SimpleNamespace(
        accs_reflection_context={
            "assistant_message_id": 42,
            "reflection_initial_score": 0.51,
            "reflection_critique": "Your previous answer needs improvement before shipping.",
            "reflection_consumed": False,
        }
    )
    messages = [{"role": "user", "content": "follow up"}]
    assert apply_accs_reflection_context(req=req, messages_for_llm=messages) is True
    sys_msgs = [m for m in messages if m.get("role") == "system"]
    assert len(sys_msgs) == 1
    assert "ACCS coach review" in str(sys_msgs[0]["content"])
    assert "42" in str(sys_msgs[0]["content"])


def test_build_accs_reflection_system_block_empty_without_critique() -> None:
    assert build_accs_reflection_system_block({}) == ""
