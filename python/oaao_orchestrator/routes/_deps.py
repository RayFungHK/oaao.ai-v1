"""W5-S1 — Shared route dependencies.

Single source of truth for the X-OAAO-Internal-Token guard that was previously
duplicated 9+ times inline in `app.py`. Use as a FastAPI dependency:

    from fastapi import Depends
    from oaao_orchestrator.routes._deps import require_internal_token

    @router.get("/secret")
    async def endpoint(_: None = Depends(require_internal_token)):
        ...
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from oaao_orchestrator._internal_secret import require_internal_secret


async def require_internal_token(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> None:
    """Reject requests missing or mismatching the shared internal token.

    Uses `secrets.compare_digest` to guard against timing oracles.
    """
    expected = require_internal_secret()
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, expected):
        raise HTTPException(status_code=403, detail="bad_internal_token")
