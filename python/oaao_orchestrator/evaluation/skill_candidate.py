"""Post-turn skill candidate heuristic (CS-4-S2)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SkillCandidate:
    proposed_title: str
    preview_md: str
    summary: str
    confidence: float
    conversation_id: int
    message_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "proposed_title": self.proposed_title,
            "preview_md": self.preview_md,
            "summary": self.summary,
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
            "message_count": self.message_count,
        }


def _user_messages(messages: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            out.append(content.strip())
    return out


def classify_skill_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_turns: int = 3,
    min_user_chars: int = 120,
) -> SkillCandidate | None:
    """Lightweight post-stream classifier — no extra LLM call in v1."""
    users = _user_messages(messages)
    if len(users) < min_turns:
        return None

    combined_user = "\n\n".join(users[-4:])
    if len(combined_user) < min_user_chars:
        return None

    assistant = (assistant_text or "").strip()
    if len(assistant) < 80:
        return None

    # Procedure-shaped threads: numbered steps or repeated imperatives.
    procedure_markers = (
        "step ",
        "steps:",
        "first,",
        "then ",
        "finally",
        "workflow",
        "checklist",
        "template",
        "always ",
        "never ",
    )
    lower = (combined_user + "\n" + assistant).lower()
    hits = sum(1 for m in procedure_markers if m in lower)
    confidence = 0.45 + min(0.4, hits * 0.08) + min(0.15, len(users) * 0.02)
    if confidence < 0.62:
        return None

    title_seed = users[-1][:80].strip().split("\n", 1)[0]
    if len(title_seed) < 8:
        title_seed = users[0][:80].strip().split("\n", 1)[0]
    proposed_title = title_seed[:72] if title_seed else "Conversation skill"

    preview_lines = [
        f"# {proposed_title}",
        "",
        "## When to use",
        users[-1][:400],
        "",
        "## Procedure (draft)",
    ]
    for line in assistant.splitlines()[:12]:
        ln = line.strip()
        if ln:
            preview_lines.append(f"- {ln[:240]}")
    preview_md = "\n".join(preview_lines).strip()

    summary = users[-1][:240]

    return SkillCandidate(
        proposed_title=proposed_title,
        preview_md=preview_md,
        summary=summary,
        confidence=min(0.92, confidence),
        conversation_id=conversation_id,
        message_count=len(users),
    )
