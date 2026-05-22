"""Micro skill entry types — extensible kinds (bound template, conversation, …)."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class SkillKind(StrEnum):
    """How a skill is stored and what it binds to."""

    BOUND_TEMPLATE = "bound_template"
    CONVERSATION = "conversation"
    WORKSPACE = "workspace"


class SkillEntry(BaseModel):
    """One skill row in the planner / discover catalog."""

    skill_id: str
    kind: str
    title: str = ""
    summary: str = ""
    bind_ref: str | None = Field(
        default=None,
        description="Required for bound skills — e.g. template_id for bound_template.",
    )
    provider_id: str = ""
    module_code: str = ""
    preview_markdown: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "published"
