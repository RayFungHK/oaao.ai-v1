"""Central accessor for the orchestrator/PHP shared secret.

W3-S1 — remove all `oaao_dev_shared_secret` fallbacks. Every call site
that previously embedded that literal must route through
``require_internal_secret()`` so a missing or empty
``OAAO_ORCH_SHARED_SECRET`` raises immediately instead of silently
signing requests with a well-known dev value.

W11-S2 — pointer schemes. The env value MAY use a provider prefix so
production deployments can resolve the secret from a managed store
without ever putting plaintext in process environment dumps:

    OAAO_ORCH_SHARED_SECRET=env:OAAO_ORCH_SHARED_SECRET_INNER
    OAAO_ORCH_SHARED_SECRET=file:/run/secrets/oaao_orch
    OAAO_ORCH_SHARED_SECRET=aws-sm:us-east-1/oaao/orch#secret   # provider hook
    OAAO_ORCH_SHARED_SECRET=vault:oaao/orch#secret              # provider hook

Plain (no prefix) values still work — that is the dev default.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

ENV_KEY = "OAAO_ORCH_SHARED_SECRET"

# Prefix tokens MUST end with ':' so we can split on the first colon
# without accidentally matching values that happen to contain "env" etc.
_SCHEME_ENV = "env:"
_SCHEME_FILE = "file:"
_SCHEME_AWS_SM = "aws-sm:"
_SCHEME_VAULT = "vault:"

_KNOWN_SCHEMES = (_SCHEME_ENV, _SCHEME_FILE, _SCHEME_AWS_SM, _SCHEME_VAULT)


class InternalSecretMissingError(RuntimeError):
    """Raised when the internal shared secret env var is unset or empty."""


class InternalSecretProviderError(RuntimeError):
    """Raised when a provider pointer (env:/file:/aws-sm:/vault:) cannot be resolved."""


def _resolve_pointer(raw: str) -> str:
    """Resolve a provider-prefixed pointer to its plaintext value.

    A plain value (no recognised scheme) is returned untouched after
    whitespace trim. Recursive resolution is **not** supported by design:
    `env:` indirection is a single hop, never a chain.
    """
    value = raw.strip()
    if not value:
        return value

    if value.startswith(_SCHEME_ENV):
        target = value[len(_SCHEME_ENV) :].strip()
        if not target:
            raise InternalSecretProviderError(
                f"{ENV_KEY} pointer 'env:' missing target variable name."
            )
        inner = (os.environ.get(target) or "").strip()
        if not inner:
            raise InternalSecretProviderError(
                f"{ENV_KEY}=env:{target} but ${target} is unset or empty."
            )
        return inner

    if value.startswith(_SCHEME_FILE):
        path_str = value[len(_SCHEME_FILE) :].strip()
        if not path_str:
            raise InternalSecretProviderError(f"{ENV_KEY} pointer 'file:' missing path.")
        try:
            content = Path(path_str).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise InternalSecretProviderError(
                f"{ENV_KEY}=file:{path_str} could not be read: {exc}"
            ) from exc
        if not content:
            raise InternalSecretProviderError(f"{ENV_KEY}=file:{path_str} is empty.")
        return content

    if value.startswith(_SCHEME_AWS_SM):
        raise InternalSecretProviderError(
            "aws-sm: provider not wired in this build. "
            "Install boto3 and replace this branch with a SecretsManager.get_secret_value() "
            f"call, or set {ENV_KEY}=env:<resolved_var> from your deployment manager."
        )

    if value.startswith(_SCHEME_VAULT):
        raise InternalSecretProviderError(
            "vault: provider not wired in this build. "
            "Install hvac and replace this branch with a Client.secrets.kv.v2.read_secret_version() "
            f"call, or set {ENV_KEY}=env:<resolved_var> from your deployment manager."
        )

    # Guard against accidental typos that *look* like a scheme but aren't supported.
    head, _, _ = value.partition(":")
    if ":" in value and f"{head}:" not in _KNOWN_SCHEMES and len(head) <= 16 and head.isalpha():
        # Heuristic: short ASCII-alpha prefix + colon → probably a mistyped scheme.
        # Stay backward-compatible: warn via exception only if it matches the shape
        # of a scheme but isn't recognised. Plain hex secrets won't trip this.
        raise InternalSecretProviderError(
            f"{ENV_KEY} starts with unknown provider scheme '{head}:'. "
            f"Known schemes: {', '.join(_KNOWN_SCHEMES)}"
        )

    return value


@lru_cache(maxsize=1)
def _cached_secret() -> str:
    raw = os.environ.get(ENV_KEY) or ""
    if not raw.strip():
        raise InternalSecretMissingError(f"{ENV_KEY} is not set; refusing to use a default secret.")
    resolved = _resolve_pointer(raw)
    if not resolved:
        raise InternalSecretMissingError(f"{ENV_KEY} resolved to an empty value.")
    return resolved


def require_internal_secret() -> str:
    """Return the internal shared secret or raise if unset/empty.

    The value is cached after the first successful read. Tests that
    mutate ``OAAO_ORCH_SHARED_SECRET`` via ``monkeypatch.setenv`` should
    call :func:`reset_cache` between cases.
    """
    return _cached_secret()


def reset_cache() -> None:
    """Clear the cached secret. Intended for tests / hot reloads."""
    _cached_secret.cache_clear()
