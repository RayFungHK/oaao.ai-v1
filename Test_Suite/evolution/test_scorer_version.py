"""Scorer version + stale turn detection."""

from __future__ import annotations

from oaao_orchestrator.evaluation.scorer_version import (
    ACCS_SCORER_VERSION,
    IQS_SCORER_VERSION,
    combined_scorer_version,
    needs_accs_rescore,
    needs_iqs_rescore,
    parse_stored_version,
)
from oaao_orchestrator.evaluation.turn_score_backfill import build_turn_rescore_item


def test_combined_scorer_version() -> None:
    assert combined_scorer_version() == f"{IQS_SCORER_VERSION}+{ACCS_SCORER_VERSION}"


def test_legacy_version_needs_rescore() -> None:
    assert needs_iqs_rescore(stored_version="post_stream_v1", iqs=0.9, iqs_dims={"clarity": 0.8})
    assert needs_accs_rescore(stored_version="post_stream_v1", accs=0.9, accs_dims={"alignment": 0.8})


def test_wrong_dimension_keys_need_rescore() -> None:
    assert needs_iqs_rescore(
        stored_version=combined_scorer_version(),
        iqs=0.9,
        iqs_dims={"clarity": 0.8, "specificity": 0.7},
    )
    assert needs_accs_rescore(
        stored_version=combined_scorer_version(),
        accs=0.9,
        accs_dims={"alignment": 0.8},
    )


def test_clarify_skips_accs_rescore() -> None:
    assert not needs_accs_rescore(
        stored_version="",
        accs=0.0,
        accs_dims={},
        iqs_action="clarify",
    )


def test_build_turn_rescore_item_skips_current() -> None:
    dims_iqs = {
        "clarity": 0.8,
        "specificity": 0.8,
        "actionability": 0.8,
        "context_completeness": 0.8,
    }
    dims_accs = {"alignment": 0.8, "accuracy": 0.8, "hallucination_penalty": 0.1}
    item = build_turn_rescore_item(
        assistant_message_id=1,
        turn_index=1,
        user_message="hello",
        assistant_content="world",
        conversation_history=[{"role": "user", "content": "hello"}],
        pipeline_snap=None,
        stored_version=combined_scorer_version(),
        iqs=0.85,
        accs=0.75,
        iqs_dims=dims_iqs,
        accs_dims=dims_accs,
        iqs_action="pass",
    )
    assert item is None


def test_parse_stored_version() -> None:
    assert parse_stored_version("iqs_v2+accs_v2") == ("iqs_v2", "accs_v2")
    assert parse_stored_version("iqs_v2") == ("iqs_v2", "")
    assert parse_stored_version("accs_v2") == ("", "accs_v2")
    assert parse_stored_version("post_stream_v1") == ("", "")


def test_partial_version_does_not_force_iqs_rescore_when_current() -> None:
    dims = {
        "clarity": 0.8,
        "specificity": 0.8,
        "actionability": 0.8,
        "context_completeness": 0.8,
    }
    assert not needs_iqs_rescore(stored_version=IQS_SCORER_VERSION, iqs=0.85, iqs_dims=dims)
