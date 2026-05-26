"""W6-S2 — Regression coverage for vault job poll + chat path helpers.

These tests target the pure helper surface (no network, no compose). They
guard against silent regressions when the vault controller / poll loop is
refactored in W6+ phases.
"""

from __future__ import annotations

import socket

import pytest
from oaao_orchestrator.vault_job_poll import (
    _html_diag_sample,
    _is_compose_web_boot_wait,
    _stub_finish_payload,
    _vault_poll_headers,
)

# ---- header builder ------------------------------------------------------ #


def test_vault_poll_headers_includes_internal_token():
    h = _vault_poll_headers("s3cret")
    assert h["X-OAAO-Internal-Token"] == "s3cret"
    assert h["Accept"].startswith("application/json")
    assert h["Content-Type"] == "application/json"
    assert h["X-Requested-With"] == "XMLHttpRequest"


def test_vault_poll_headers_empty_secret_allowed():
    # Function does not validate emptiness — caller is responsible.
    h = _vault_poll_headers("")
    assert h["X-OAAO-Internal-Token"] == ""


# ---- HTML diagnostic sampler -------------------------------------------- #


def test_html_diag_sample_extracts_title():
    body = "<html><head><title>  Boom \n Error  </title></head><body></body></html>"
    out = _html_diag_sample(body)
    assert "Boom Error" in out


def test_html_diag_sample_extracts_pre():
    body = "<html><body><pre>Fatal error: blah</pre></body></html>"
    out = _html_diag_sample(body)
    assert "Fatal error" in out


def test_html_diag_sample_plain_fallback():
    body = "no html tags here just a stack hint"
    out = _html_diag_sample(body)
    assert "no html tags here" in out


# ---- stub finish payload ------------------------------------------------ #


def test_stub_finish_payload_default_is_failed(monkeypatch):
    monkeypatch.delenv("OAAO_VAULT_JOB_STUB_MODE", raising=False)
    out = _stub_finish_payload(42)
    assert out["job_id"] == 42
    assert out["status"] == "failed"
    assert "error" in out


def test_stub_finish_payload_complete_mode(monkeypatch):
    monkeypatch.setenv("OAAO_VAULT_JOB_STUB_MODE", "complete")
    out = _stub_finish_payload(7)
    assert out == {"job_id": 7, "status": "completed"}


def test_stub_finish_payload_unknown_mode_treated_as_fail(monkeypatch):
    monkeypatch.setenv("OAAO_VAULT_JOB_STUB_MODE", "whatever-mode")
    out = _stub_finish_payload(1)
    assert out["status"] == "failed"


# ---- compose web boot detector ----------------------------------------- #


def test_compose_web_boot_wait_only_for_web_host():
    err = socket.gaierror("Name or service not known")
    assert _is_compose_web_boot_wait("web", err) is True
    assert _is_compose_web_boot_wait("orchestrator", err) is False
    assert _is_compose_web_boot_wait("localhost", err) is False


@pytest.mark.parametrize(
    "msg",
    [
        "Name or service not known",
        "nodename nor servname provided",
        "Temporary failure in name resolution",
        "getaddrinfo failed",
    ],
)
def test_compose_web_boot_wait_recognises_dns_errors(msg):
    assert _is_compose_web_boot_wait("web", RuntimeError(msg)) is True


def test_compose_web_boot_wait_ignores_unrelated_error():
    assert _is_compose_web_boot_wait("web", RuntimeError("connection refused")) is False
