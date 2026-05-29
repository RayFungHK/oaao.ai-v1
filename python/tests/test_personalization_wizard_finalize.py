"""Personalization survey finalize helpers."""

from oaao_orchestrator.personalization_wizard import (
    _fallback_finalize_params,
    _merge_finalize_params,
)


def test_merge_finalize_params_user_overrides() -> None:
    base = {"temperature": 0.3, "top_p": 0.85}
    user = {"temperature": 0.55, "top_k": None}
    out = _merge_finalize_params(base, user)
    assert out["temperature"] == 0.55
    assert out["top_p"] == 0.85
    assert "top_k" not in out


def test_fallback_finalize_respects_user_adjustments() -> None:
    row = {
        "id": "option_a",
        "style_label": "Steady",
        "model_params": {"temperature": 0.3, "top_p": 0.8},
    }
    out = _fallback_finalize_params(row, {"top_p": 0.9})
    assert out["temperature"] == 0.3
    assert out["top_p"] == 0.9
