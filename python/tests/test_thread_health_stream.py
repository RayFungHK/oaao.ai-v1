"""Thread health stream helpers."""

from oaao_orchestrator.evaluation.thread_health_stream import provisional_health_from_accs


def test_provisional_health_low_accs():
    health = provisional_health_from_accs(conversation_id=42, accs_score=0.55, user_message="hello")
    assert health is not None
    assert health.conversation_id == 42
    assert health.alert != "none"


def test_provisional_health_skips_good_accs():
    assert provisional_health_from_accs(conversation_id=1, accs_score=0.9) is None
