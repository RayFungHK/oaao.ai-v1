"""WS-1-S4 — Knowledge bucket entries (platform / tenant global catalog)."""

from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, Field

AssetScope = Literal["platform", "tenant"]
AssetTier = Literal[
    "session",
    "tenant",
    "vault",
    "evolution",
    "crystallized",
]


class WebKnowledgeHitV1(BaseModel):
    title: str = ""
    url: str = ""
    snippet: str = ""
    provider: str = "searxng"
    plan_query: str = ""
    plan_reason: str = ""


class WebKnowledgeAssetV1(BaseModel):
    """
    One Knowledge bucket entry (public web capture) — catalog keyed by **tenant** or **platform**.

    ``workspace_id`` is attribution only. Any oaao module may consume after promotion.
    Lane: session → bucket catalog → (ACCS) knowledge vault embed → evolution_patches → crystallized/LoRA.
    """

    version: int = 1
    asset_id: str
    scope: AssetScope = "tenant"
    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(default=None, ge=1)
    conversation_id: str | None = None
    run_id: str | None = None
    tier: AssetTier = "tenant"
    content_hash: str = ""
    query: str = ""
    plan_method: str = ""
    hits: list[WebKnowledgeHitV1] = Field(default_factory=list)
    orientation_topics: list[str] = Field(default_factory=list)
    accs_score: float | None = None
    promoted_to_vault_id: int | None = None
    evolution_patch_id: str | None = None
    created_at: float = Field(default_factory=time.time)
    meta: dict[str, Any] = Field(default_factory=dict)
