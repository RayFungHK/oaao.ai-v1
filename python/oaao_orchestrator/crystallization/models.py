"""Crystallized skill schema (Evolution §8.2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class CrystallizedSkill(BaseModel):
    id: str
    trigger_intent: str = Field(max_length=80)
    intent_embedding: list[float] = Field(default_factory=list)
    tool_chain: list[str] = Field(default_factory=list)
    param_template: dict[str, Any] = Field(default_factory=dict)
    success_score: float = Field(ge=0.0, le=1.0)
    usage_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: datetime | None = None
    source_run_id: str = ""


class RecallHit(BaseModel):
    skill: CrystallizedSkill
    similarity: float = Field(ge=0.0, le=1.0)
