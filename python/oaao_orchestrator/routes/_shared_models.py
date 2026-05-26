"""W5-S1 — Pydantic models shared across `app.py` and `routes/*`.

Currently hosts ``EndpointPayload`` which is referenced both by
``ChatRunRequest`` (still in ``app.py``) and by the slides request
models in ``routes/slides.py``. Pulled out so route modules can import
it without creating a circular dependency on ``app.py``.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EndpointPayload(BaseModel):
    """Subset of ``oaao_endpoint`` for ingress — OpenAI-compatible chat completions
    today; provider taxonomy TBD vs Open Web UI."""

    endpoint_ref: str = ""
    endpoint_id: int | None = Field(default=None, ge=1)
    base_url: str
    model: str
    api_key_env: str | None = Field(
        default=None, description="Environment variable name on this process"
    )
