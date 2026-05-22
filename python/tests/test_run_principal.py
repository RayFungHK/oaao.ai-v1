"""Run principal HMAC — PHP/Python parity."""

from __future__ import annotations

from oaao_orchestrator.run_principal import issue_token, require_for_request, verify_token
from types import SimpleNamespace


def test_issue_and_verify_roundtrip() -> None:
    secret = "test_secret"
    token = issue_token(
        user_id=7,
        conversation_id=42,
        assistant_message_id=99,
        workspace_id=3,
        tenant_id=1,
        secret=secret,
    )
    principal = verify_token(token, secret=secret)
    assert principal is not None
    assert principal.user_id == 7
    assert principal.conversation_id == 42
    assert principal.assistant_message_id == 99


def test_require_for_request_matches_payload(monkeypatch) -> None:
    secret = "test_secret"
    monkeypatch.setenv("OAAO_ORCH_SHARED_SECRET", secret)
    token = issue_token(
        user_id=1,
        conversation_id=10,
        assistant_message_id=20,
        secret=secret,
    )
    req = SimpleNamespace(
        run_principal=token,
        user_id="1",
        conversation_id="10",
        assistant_message_id="20",
        workspace_id=None,
        tenant_id=None,
    )
    assert require_for_request(req) is not None
