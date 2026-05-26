"""W10-S2 (backlog) — CORS allowlist contract.

Defaults must be localhost-only. Wildcard requires explicit opt-in env flag.
allow_credentials must be False whenever the wildcard is active (CORS spec).
"""

from __future__ import annotations

import importlib

import pytest


def _reload_app(monkeypatch: pytest.MonkeyPatch):
    # Required env for orchestrator boot.
    monkeypatch.setenv("OAAO_ORCH_SHARED_SECRET", "test_secret_for_cors")
    import oaao_orchestrator.app as app_mod

    importlib.reload(app_mod)
    return app_mod


def _cors_middleware(app_mod):
    from fastapi.middleware.cors import CORSMiddleware

    for mw in app_mod.app.user_middleware:
        if mw.cls is CORSMiddleware:
            return mw
    raise AssertionError("CORSMiddleware not installed")


def test_default_origins_are_localhost_only(monkeypatch):
    monkeypatch.delenv("OAAO_CORS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("OAAO_CORS_ALLOW_WILDCARD", raising=False)
    monkeypatch.delenv("OAAO_CORS_ALLOW_CREDENTIALS", raising=False)
    app_mod = _reload_app(monkeypatch)
    mw = _cors_middleware(app_mod)
    assert "*" not in mw.kwargs["allow_origins"]
    assert "http://localhost" in mw.kwargs["allow_origins"]
    assert mw.kwargs["allow_credentials"] is False


def test_explicit_origins_parsed_from_env(monkeypatch):
    monkeypatch.setenv(
        "OAAO_CORS_ALLOWED_ORIGINS",
        "https://app.oaao.ai, https://admin.oaao.ai ,  ",
    )
    monkeypatch.delenv("OAAO_CORS_ALLOW_WILDCARD", raising=False)
    app_mod = _reload_app(monkeypatch)
    mw = _cors_middleware(app_mod)
    assert mw.kwargs["allow_origins"] == [
        "https://app.oaao.ai",
        "https://admin.oaao.ai",
    ]


def test_wildcard_without_optin_falls_back(monkeypatch):
    monkeypatch.setenv("OAAO_CORS_ALLOWED_ORIGINS", "*")
    monkeypatch.delenv("OAAO_CORS_ALLOW_WILDCARD", raising=False)
    app_mod = _reload_app(monkeypatch)
    mw = _cors_middleware(app_mod)
    assert "*" not in mw.kwargs["allow_origins"]
    assert "http://localhost" in mw.kwargs["allow_origins"]


def test_wildcard_with_optin_disables_credentials(monkeypatch):
    monkeypatch.setenv("OAAO_CORS_ALLOWED_ORIGINS", "*")
    monkeypatch.setenv("OAAO_CORS_ALLOW_WILDCARD", "1")
    monkeypatch.setenv("OAAO_CORS_ALLOW_CREDENTIALS", "1")  # must be ignored
    app_mod = _reload_app(monkeypatch)
    mw = _cors_middleware(app_mod)
    assert mw.kwargs["allow_origins"] == ["*"]
    # CORS spec: wildcard + credentials is forbidden.
    assert mw.kwargs["allow_credentials"] is False


def test_explicit_origins_with_credentials_opt_in(monkeypatch):
    monkeypatch.setenv("OAAO_CORS_ALLOWED_ORIGINS", "https://app.oaao.ai")
    monkeypatch.setenv("OAAO_CORS_ALLOW_CREDENTIALS", "1")
    monkeypatch.delenv("OAAO_CORS_ALLOW_WILDCARD", raising=False)
    app_mod = _reload_app(monkeypatch)
    mw = _cors_middleware(app_mod)
    assert mw.kwargs["allow_origins"] == ["https://app.oaao.ai"]
    assert mw.kwargs["allow_credentials"] is True
