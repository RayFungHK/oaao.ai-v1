from __future__ import annotations

from oaao_orchestrator.post_stream_schemas import (
    AccsScoreResult,
    IqsScoreResult,
    parse_plugin_score,
)


def test_parse_iqs_and_accs() -> None:
    iqs = parse_plugin_score(
        "iqs",
        {"iqs": 0.8, "dimensions": {"clarity": 0.9}, "reasons": {"clarity": "ok"}},
    )
    assert isinstance(iqs, IqsScoreResult)
    assert iqs.iqs == 0.8

    accs = parse_plugin_score(
        "accs",
        {"accs": 0.7, "dimensions": {"coherence": 0.6}, "reasons": {}},
    )
    assert isinstance(accs, AccsScoreResult)
    assert accs.accs == 0.7


def test_parse_invalid_returns_none() -> None:
    assert parse_plugin_score("iqs", {"bad": True}) is None
