"""Suggest micro skill version upgrade after repeated successful use (CS-4-S7)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


def skill_upgrade_usage_threshold() -> int:
    raw = os.environ.get("OAAO_SKILL_UPGRADE_USAGE_THRESHOLD", "5").strip()
    try:
        return max(2, min(50, int(raw)))
    except ValueError:
        return 5


def skill_upgrade_accs_min() -> float | None:
    """Optional ACCS floor — omit gate when env unset or 0."""
    raw = os.environ.get("OAAO_SKILL_UPGRADE_ACCS_MIN", "").strip()
    if not raw:
        return None
    try:
        val = float(raw)
        return val if 0 < val <= 1 else None
    except ValueError:
        return None


@dataclass
class SkillUpgradeCandidate:
    skill_id: str
    title: str
    usage_count: int
    version: int
    parent_skill_id: str | None
    preview_md: str
    summary: str
    conversation_id: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "skill_id": self.skill_id,
            "title": self.title,
            "usage_count": int(self.usage_count),
            "version": int(self.version),
            "parent_skill_id": self.parent_skill_id,
            "preview_md": self.preview_md[:12000],
            "summary": self.summary[:500],
            "conversation_id": self.conversation_id,
            "proposed_title": f"{self.title} (v{self.version + 1})",
        }


def pick_skill_upgrade_candidate(
    *,
    conversation_id: int,
    skill_rows: list[dict[str, Any]],
    accs_score: float | None = None,
) -> SkillUpgradeCandidate | None:
    """Return the first skill that crossed the usage threshold this bump."""
    threshold = skill_upgrade_usage_threshold()
    accs_min = skill_upgrade_accs_min()
    if accs_min is not None and accs_score is not None and float(accs_score) < accs_min:
        return None
    for row in skill_rows:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("skill_id") or "").strip()
        if not sid:
            continue
        usage = int(row.get("usage_count") or 0)
        if usage < threshold or usage != threshold:
            continue
        title = str(row.get("title") or sid).strip()
        preview = str(row.get("preview_markdown") or "").strip()
        summary = str(row.get("summary") or "").strip()
        version = int(row.get("version") or 1)
        parent = row.get("parent_skill_id")
        parent_id = str(parent).strip() if isinstance(parent, str) and parent.strip() else None
        return SkillUpgradeCandidate(
            skill_id=sid,
            title=title,
            usage_count=usage,
            version=version,
            parent_skill_id=parent_id,
            preview_md=preview or f"# {title}\n\n(Reusable procedure — consider saving v{version + 1}.)",
            summary=summary or f"Used {usage} times — refine and save as v{version + 1}.",
            conversation_id=conversation_id,
        )
    return None
