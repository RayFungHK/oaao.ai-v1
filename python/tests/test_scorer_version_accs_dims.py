from __future__ import annotations

from oaao_orchestrator.evaluation.coach_client import enrich_accs_display_factors
from oaao_orchestrator.evaluation.scorer_version import needs_accs_rescore


def test_needs_accs_rescore_accepts_enriched_display_factors() -> None:
    factors = enrich_accs_display_factors(
        {
            "alignment": 0.72,
            "accuracy": 0.74,
            "hallucination_penalty": 0.05,
        }
    )
    assert needs_accs_rescore(
        stored_version="iqs_v2+accs_v2",
        accs=0.71,
        accs_dims=factors,
    ) is False


def test_needs_accs_rescore_still_true_when_accs_missing() -> None:
    assert needs_accs_rescore(
        stored_version="iqs_v2+accs_v2",
        accs=0.0,
        accs_dims={},
    ) is True
