"""W3-S1 — internal shared secret helper contract.

W11-S2 — provider pointer schemes (env:/file:/aws-sm:/vault:).
"""

from __future__ import annotations

import pytest
from oaao_orchestrator import _internal_secret
from oaao_orchestrator._internal_secret import (
    ENV_KEY,
    InternalSecretMissingError,
    InternalSecretProviderError,
    require_internal_secret,
    reset_cache,
)


def _clear(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_KEY, raising=False)
    reset_cache()


def test_missing_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    with pytest.raises(InternalSecretMissingError):
        require_internal_secret()


def test_empty_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "   ")
    reset_cache()
    with pytest.raises(InternalSecretMissingError):
        require_internal_secret()


def test_present_env_returns_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "  s3cret-value  ")
    reset_cache()
    assert require_internal_secret() == "s3cret-value"


def test_cache_isolated_across_resets(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "first")
    reset_cache()
    assert require_internal_secret() == "first"
    monkeypatch.setenv(ENV_KEY, "second")
    # No reset → cached value remains
    assert require_internal_secret() == "first"
    reset_cache()
    assert require_internal_secret() == "second"


# ── W11-S2: provider pointer schemes ──────────────────────────────────────────


def test_env_indirect_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv("OAAO_ORCH_SHARED_SECRET_INNER", "resolved-via-env")
    monkeypatch.setenv(ENV_KEY, "env:OAAO_ORCH_SHARED_SECRET_INNER")
    reset_cache()
    assert require_internal_secret() == "resolved-via-env"


def test_env_indirect_missing_target_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.delenv("OAAO_ORCH_SHARED_SECRET_INNER", raising=False)
    monkeypatch.setenv(ENV_KEY, "env:OAAO_ORCH_SHARED_SECRET_INNER")
    reset_cache()
    with pytest.raises(InternalSecretProviderError):
        require_internal_secret()


def test_env_indirect_blank_target_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "env:")
    reset_cache()
    with pytest.raises(InternalSecretProviderError):
        require_internal_secret()


def test_file_pointer_reads_and_trims(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    _clear(monkeypatch)
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("  file-secret-value  \n", encoding="utf-8")
    monkeypatch.setenv(ENV_KEY, f"file:{secret_path}")
    reset_cache()
    assert require_internal_secret() == "file-secret-value"


def test_file_pointer_missing_raises(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, f"file:{tmp_path / 'does-not-exist'}")
    reset_cache()
    with pytest.raises(InternalSecretProviderError):
        require_internal_secret()


def test_file_pointer_empty_raises(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    _clear(monkeypatch)
    secret_path = tmp_path / "empty.txt"
    secret_path.write_text("   \n", encoding="utf-8")
    monkeypatch.setenv(ENV_KEY, f"file:{secret_path}")
    reset_cache()
    with pytest.raises(InternalSecretProviderError, match="is empty"):
        require_internal_secret()


def test_aws_sm_pointer_raises_not_wired(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "aws-sm:us-east-1/oaao/orch#secret")
    reset_cache()
    with pytest.raises(InternalSecretProviderError, match="aws-sm"):
        require_internal_secret()


def test_vault_pointer_raises_not_wired(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "vault:oaao/orch#secret")
    reset_cache()
    with pytest.raises(InternalSecretProviderError, match="vault"):
        require_internal_secret()


def test_unknown_scheme_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "doppler:project/secret")
    reset_cache()
    with pytest.raises(InternalSecretProviderError, match="unknown provider scheme"):
        require_internal_secret()


def test_plain_hex_value_not_treated_as_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 64-char hex secret must not trigger the unknown-scheme heuristic."""
    _clear(monkeypatch)
    monkeypatch.setenv(ENV_KEY, "a" * 64)
    reset_cache()
    assert require_internal_secret() == "a" * 64


def teardown_module(module: object) -> None:
    _internal_secret.reset_cache()
