"""W10-S2 — CORS allowlist configuration helper.

Extracted from `app.py` so the parsing/safety rules can be unit-tested
without spinning up FastAPI. Behaviour mirrors what `app.py` previously
inlined:

- `OAAO_CORS_ALLOWED_ORIGINS` is a comma-separated allowlist.
- Empty / unset → safe localhost default (`http://localhost(:8080)?`,
  `http://127.0.0.1(:8080)?`).
- A literal `"*"` requires `OAAO_CORS_ALLOW_WILDCARD=1` AND forces
  `allow_credentials=False` per the CORS spec.
- `OAAO_CORS_ALLOW_CREDENTIALS=1` only takes effect when the resolved
  allowlist is *not* a wildcard.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


_LOCALHOST_DEFAULTS: tuple[str, ...] = (
    "http://localhost",
    "http://localhost:8080",
    "http://127.0.0.1",
    "http://127.0.0.1:8080",
)


@dataclass(frozen=True)
class CorsConfig:
    origins: tuple[str, ...]
    allow_credentials: bool
    wildcard: bool

    def as_middleware_kwargs(self) -> dict[str, object]:
        return {
            "allow_origins": list(self.origins),
            "allow_credentials": self.allow_credentials,
            "allow_methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["*"],
        }


def resolve_cors_config(env: dict[str, str] | None = None) -> CorsConfig:
    """Resolve `CorsConfig` from env. Pass `env=` for tests."""
    src = env if env is not None else os.environ

    raw = (src.get("OAAO_CORS_ALLOWED_ORIGINS") or "").strip()
    origins = tuple(o.strip() for o in raw.split(",") if o.strip()) if raw else _LOCALHOST_DEFAULTS

    wildcard = origins == ("*",)

    if wildcard and (src.get("OAAO_CORS_ALLOW_WILDCARD") or "") != "1":
        logger.warning(
            "cors_config: '*' supplied without OAAO_CORS_ALLOW_WILDCARD=1; "
            "falling back to localhost allowlist."
        )
        origins = _LOCALHOST_DEFAULTS
        wildcard = False

    allow_credentials = (src.get("OAAO_CORS_ALLOW_CREDENTIALS") or "") == "1" and not wildcard
    return CorsConfig(
        origins=origins, allow_credentials=allow_credentials, wildcard=wildcard
    )
