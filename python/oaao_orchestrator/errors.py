"""W4-S2 — Structured error codes for the orchestrator.

Single source of truth for API error responses. Each code is stable across
versions and pairs with a default HTTP status and operator-facing message.

Usage:

    from oaao_orchestrator.errors import OAAOError, OAAOErrorCode

    raise OAAOError(OAAOErrorCode.SECRET_MISSING, detail="OAAO_ORCH_SHARED_SECRET")

Or, to return without raising (FastAPI handler / WebSocket close):

    payload = OAAOError(OAAOErrorCode.AUTH_INVALID).to_payload()
    code = OAAOErrorCode.AUTH_INVALID.ws_close_code  # 4401

Codes are namespaced by domain (AUTH_*, INPUT_*, RUN_*, …). Adding a new code
requires bumping nothing — only retiring/renaming an existing code is a
breaking change for clients.

Cross-language contract: the PHP backbone has a mirror at
`backbone/sites/oaaoai/oaaoai/core/library/OaaoErrorCode.php`. Both files must
stay in sync — see docs/error-codes.md (to be added) for the canonical table.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class OAAOErrorCode(StrEnum):
    """Stable string codes returned in API error payloads."""

    # ── Auth (4xxx) ─────────────────────────────────────────────────────────
    AUTH_MISSING = "OAAO_E_AUTH_MISSING"
    AUTH_INVALID = "OAAO_E_AUTH_INVALID"
    AUTH_EXPIRED = "OAAO_E_AUTH_EXPIRED"
    AUTH_FORBIDDEN = "OAAO_E_AUTH_FORBIDDEN"

    # ── Input validation (5xxx) ─────────────────────────────────────────────
    INPUT_MISSING = "OAAO_E_INPUT_MISSING"
    INPUT_INVALID = "OAAO_E_INPUT_INVALID"
    INPUT_TOO_LARGE = "OAAO_E_INPUT_TOO_LARGE"

    # ── Resource (6xxx) ─────────────────────────────────────────────────────
    RESOURCE_NOT_FOUND = "OAAO_E_RESOURCE_NOT_FOUND"
    RESOURCE_CONFLICT = "OAAO_E_RESOURCE_CONFLICT"
    RESOURCE_GONE = "OAAO_E_RESOURCE_GONE"

    # ── Config / secrets (7xxx) ─────────────────────────────────────────────
    SECRET_MISSING = "OAAO_E_SECRET_MISSING"
    SECRET_PROVIDER = "OAAO_E_SECRET_PROVIDER"
    CONFIG_INVALID = "OAAO_E_CONFIG_INVALID"

    # ── Run / pipeline (8xxx) ───────────────────────────────────────────────
    RUN_FAILED = "OAAO_E_RUN_FAILED"
    RUN_TIMEOUT = "OAAO_E_RUN_TIMEOUT"
    RUN_CANCELLED = "OAAO_E_RUN_CANCELLED"
    UPSTREAM_FAILED = "OAAO_E_UPSTREAM_FAILED"
    UPSTREAM_TIMEOUT = "OAAO_E_UPSTREAM_TIMEOUT"

    # ── Generic (9xxx) ──────────────────────────────────────────────────────
    INTERNAL = "OAAO_E_INTERNAL"
    NOT_IMPLEMENTED = "OAAO_E_NOT_IMPLEMENTED"


# Lookup tables -----------------------------------------------------------------
# `http_status` is the recommended default; handlers may override.
# `ws_close_code` is the recommended WebSocket close code (4000-4999 reserved
# for app-level codes); None means "do not use over a WS channel".

_HTTP_STATUS: dict[OAAOErrorCode, int] = {
    OAAOErrorCode.AUTH_MISSING: 401,
    OAAOErrorCode.AUTH_INVALID: 401,
    OAAOErrorCode.AUTH_EXPIRED: 401,
    OAAOErrorCode.AUTH_FORBIDDEN: 403,
    OAAOErrorCode.INPUT_MISSING: 400,
    OAAOErrorCode.INPUT_INVALID: 400,
    OAAOErrorCode.INPUT_TOO_LARGE: 413,
    OAAOErrorCode.RESOURCE_NOT_FOUND: 404,
    OAAOErrorCode.RESOURCE_CONFLICT: 409,
    OAAOErrorCode.RESOURCE_GONE: 410,
    OAAOErrorCode.SECRET_MISSING: 500,
    OAAOErrorCode.SECRET_PROVIDER: 500,
    OAAOErrorCode.CONFIG_INVALID: 500,
    OAAOErrorCode.RUN_FAILED: 500,
    OAAOErrorCode.RUN_TIMEOUT: 504,
    OAAOErrorCode.RUN_CANCELLED: 499,
    OAAOErrorCode.UPSTREAM_FAILED: 502,
    OAAOErrorCode.UPSTREAM_TIMEOUT: 504,
    OAAOErrorCode.INTERNAL: 500,
    OAAOErrorCode.NOT_IMPLEMENTED: 501,
}

_WS_CLOSE: dict[OAAOErrorCode, int] = {
    OAAOErrorCode.AUTH_MISSING: 4401,
    OAAOErrorCode.AUTH_INVALID: 4401,
    OAAOErrorCode.AUTH_EXPIRED: 4401,
    OAAOErrorCode.AUTH_FORBIDDEN: 4403,
    OAAOErrorCode.RESOURCE_NOT_FOUND: 4404,
    OAAOErrorCode.INPUT_INVALID: 4400,
    OAAOErrorCode.RUN_FAILED: 4500,
    OAAOErrorCode.INTERNAL: 4500,
}


def http_status_for(code: OAAOErrorCode) -> int:
    return _HTTP_STATUS.get(code, 500)


def ws_close_for(code: OAAOErrorCode) -> int | None:
    return _WS_CLOSE.get(code)


@dataclass(frozen=True)
class OAAOError(Exception):
    """Structured error payload that can be raised or serialised."""

    code: OAAOErrorCode
    detail: str = ""
    cause: str = ""

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code.value}: {self.detail}" if self.detail else self.code.value

    @property
    def http_status(self) -> int:
        return http_status_for(self.code)

    @property
    def ws_close_code(self) -> int | None:
        return ws_close_for(self.code)

    def to_payload(self) -> dict[str, Any]:
        """JSON-serialisable error body. Stable shape across all endpoints."""
        body: dict[str, Any] = {"ok": False, "error": {"code": self.code.value}}
        if self.detail:
            body["error"]["detail"] = self.detail
        if self.cause:
            body["error"]["cause"] = self.cause
        return body
