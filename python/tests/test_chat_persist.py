"""Tests for assistant meta merge on orchestrator persist."""

from __future__ import annotations

from oaao_orchestrator.chat_persist import _merge_meta_dict


def test_merge_meta_preserves_orchestrator_prompt_debug():
    existing = {
        "orchestrator_prompt_debug": {
            "module_prompts": {"compose_assistant": {"calendar": {"content": "fence rules"}}},
            "run_id": "abc",
        },
        "inference": {"mode": "auto"},
    }
    patch = {
        "orchestrator_prompt_debug": {
            "compose_injected": "injected body",
            "compose_injected_chars": 13,
        },
        "persisted_by_orchestrator": True,
        "iqs_score": 0.9,
    }
    merged = _merge_meta_dict(existing, patch)
    assert merged["iqs_score"] == 0.9
    assert merged["inference"] == {"mode": "auto"}
    debug = merged["orchestrator_prompt_debug"]
    assert debug["run_id"] == "abc"
    assert debug["compose_injected"] == "injected body"
    assert "module_prompts" in debug


def test_merge_meta_patch_wins_for_non_debug_keys():
    existing = {"model": "old"}
    patch = {"model": "new", "tokens_out": 42}
    merged = _merge_meta_dict(existing, patch)
    assert merged["model"] == "new"
    assert merged["tokens_out"] == 42
