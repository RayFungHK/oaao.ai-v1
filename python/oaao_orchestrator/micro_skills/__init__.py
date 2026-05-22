"""Micro skills registry — bound (template), conversation, and future providers."""

from oaao_orchestrator.micro_skills.discover import discover_skills_llm
from oaao_orchestrator.micro_skills.markdown import skill_preview_markdown
from oaao_orchestrator.micro_skills.registry import (
    catalog_from_request,
    catalog_summary_for_planner,
    merge_skill_payload,
)
from oaao_orchestrator.micro_skills.types import SkillEntry, SkillKind

__all__ = [
    "SkillEntry",
    "SkillKind",
    "catalog_from_request",
    "catalog_summary_for_planner",
    "discover_skills_llm",
    "merge_skill_payload",
    "skill_preview_markdown",
]
