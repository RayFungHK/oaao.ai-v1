"""WS-1-S2 — orientation_json (platform / tenant global scope)."""

from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, Field

OrientationScope = Literal["platform", "tenant"]


class OrientationJsonV1(BaseModel):
    version: int = 1
    scope: OrientationScope = "tenant"
    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(
        default=None,
        ge=1,
        description="Last workspace that contributed (attribution, not partition key).",
    )
    conversation_id: str | None = None
    topics: list[str] = Field(default_factory=list, max_length=24)
    entities: list[str] = Field(default_factory=list, max_length=32)
    language: str = "zh-Hant"
    recency_days: int | None = Field(default=30, ge=1, le=365)
    search_queries_suggested: list[str] = Field(default_factory=list, max_length=12)
    do_not_search: list[str] = Field(default_factory=list, max_length=24)
    summary: str = Field(default="", max_length=2000)
    topic_signals: dict[str, dict[str, object]] = Field(
        default_factory=dict,
        description="Platform topic lifecycle (importance, yield, pause) — WS-1-S10.",
    )
    updated_at: float = Field(default_factory=time.time)


class OrientationUpdateResult(BaseModel):
    ok: bool = True
    scope: OrientationScope
    tenant_id: int | None = None
    workspace_id: int | None = None
    orientation: OrientationJsonV1
    effective_orientation: OrientationJsonV1 | None = None
    method: str = "llm"
