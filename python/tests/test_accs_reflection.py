"""ACCS action thresholds — Evolution §5.3 / §6."""

from oaao_orchestrator.evaluation.accs import THRESHOLD_SHIP, _action_for_score


def test_action_ship_at_threshold():
    action, crystallize, degraded = _action_for_score(0.85)
    assert action == "ship"
    assert crystallize is True
    assert degraded is False


def test_action_reflect_below_ship():
    action, crystallize, degraded = _action_for_score(0.64)
    assert action == "reflect"
    assert crystallize is False
    assert degraded is False


def test_action_reflect_very_low_still_reflects():
    action, crystallize, degraded = _action_for_score(0.25)
    assert action == "reflect"
    assert degraded is False


def test_ship_boundary():
    action, _, _ = _action_for_score(THRESHOLD_SHIP)
    assert action == "ship"
