"""Shared bearer-token resolution for upstream LLM endpoints.

Extracted from ``app.py`` so route modules (currently ``routes.skills``;
later ``routes.runs`` for ``/v1/runs/chat``) can resolve API keys without
importing from ``app.py`` and creating an import cycle.

Both helpers fall back to ``OPENAI_API_KEY`` when the per-endpoint env
variable is missing or empty.
"""

from __future__ import annotations

import os
from typing import Any


def resolve_api_key(ep: Any | None) -> str | None:
    """Bearer token from sidecar env (per ``EndpointPayload.api_key_env``)."""
    if ep is None:
        fb = os.environ.get("OPENAI_API_KEY")
        return fb.strip() if isinstance(fb, str) and fb.strip() else None
    name = (ep.api_key_env or "").strip() or "OPENAI_API_KEY"
    v = os.environ.get(name)
    if isinstance(v, str):
        v = v.strip()
        if v:
            return v
    fb = os.environ.get("OPENAI_API_KEY")
    if isinstance(fb, str):
        fb = fb.strip()
        if fb:
            return fb
    return None


def resolve_api_key_env_dict(snap: dict[str, Any] | None) -> str | None:
    """Bearer token from a purpose snapshot dict (``api_key_env`` field)."""
    if not isinstance(snap, dict):
        return None
    name = str(snap.get("api_key_env") or "").strip() or "OPENAI_API_KEY"
    v = os.environ.get(name)
    if isinstance(v, str):
        v = v.strip()
        if v:
            return v
    fb = os.environ.get("OPENAI_API_KEY")
    if isinstance(fb, str):
        fb = fb.strip()
        if fb:
            return fb
    return None
