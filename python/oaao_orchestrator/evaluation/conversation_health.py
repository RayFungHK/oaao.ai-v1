"""Conversation thread health — IQS/ACCS trends, drift, misunderstanding loops (P1-1)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

LOW_ACCS = 0.65
LOW_ALIGNMENT = 0.55
ACCS_DROP_ALERT = 0.15
STREAK_LOW_ACCS = 2

_USER_CORRECTION_RE = re.compile(
    r"(补完|不对|不是这个|不是這個|重答|离题|離題|听不懂|聽不懂|理解错|理解錯|搞错|搞錯|please complete|not what i)",
    re.IGNORECASE,
)


@dataclass
class TurnScorePoint:
    turn_index: int
    assistant_message_id: int = 0
    iqs: float = 0.0
    accs: float = 0.0
    topic_shift: int = 0
    alignment: float = 0.0
    user_message: str = ""


@dataclass
class ConversationHealth:
    conversation_id: int
    turn_count: int = 0
    trend: str = "stable"
    accs_rolling_p50: float = 0.0
    iqs_rolling_p50: float = 0.0
    accs_delta_last: float | None = None
    consecutive_low_accs: int = 0
    topic_shift_count: int = 0
    user_correction_turns: int = 0
    alert: str = "none"
    alerts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "turn_count": self.turn_count,
            "trend": self.trend,
            "accs_rolling_p50": round(self.accs_rolling_p50, 4),
            "iqs_rolling_p50": round(self.iqs_rolling_p50, 4),
            "accs_delta_last": round(self.accs_delta_last, 4)
            if self.accs_delta_last is not None
            else None,
            "consecutive_low_accs": self.consecutive_low_accs,
            "topic_shift_count": self.topic_shift_count,
            "user_correction_turns": self.user_correction_turns,
            "alert": self.alert,
            "alerts": list(self.alerts),
        }


def is_user_correction(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    return bool(_USER_CORRECTION_RE.search(raw))


def topic_shift_flag(
    *,
    user_message: str,
    accs_factors: dict[str, float] | None,
    accs_score: float,
) -> int:
    """Heuristic topic / alignment shift for one turn (P1-2)."""
    factors = accs_factors or {}
    try:
        alignment = float(factors.get("alignment") or 0.0)
    except (TypeError, ValueError):
        alignment = 0.0
    if alignment > 0 and alignment < LOW_ALIGNMENT:
        return 1
    if accs_score > 0 and accs_score < LOW_ACCS and is_user_correction(user_message):
        return 1
    if is_user_correction(user_message) and alignment > 0 and alignment < LOW_ACCS:
        return 1
    return 0


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return float((ordered[mid - 1] + ordered[mid]) / 2.0)


def analyze_conversation_health(
    conversation_id: int,
    turns: list[TurnScorePoint],
    *,
    window: int = 5,
) -> ConversationHealth:
    """Aggregate per-turn scores into thread-level health signals."""
    out = ConversationHealth(conversation_id=conversation_id)
    scored = [t for t in turns if t.accs > 0 or t.iqs > 0]
    out.turn_count = len(scored)
    if not scored:
        return out

    accs_vals = [t.accs for t in scored if t.accs > 0]
    iqs_vals = [t.iqs for t in scored if t.iqs > 0]
    tail = scored[-window:]
    tail_accs = [t.accs for t in tail if t.accs > 0]
    out.accs_rolling_p50 = _median(tail_accs if tail_accs else accs_vals)
    out.iqs_rolling_p50 = _median([t.iqs for t in tail if t.iqs > 0] or iqs_vals)
    out.topic_shift_count = sum(1 for t in scored if t.topic_shift)
    out.user_correction_turns = sum(1 for t in scored if is_user_correction(t.user_message))

    streak = 0
    for t in reversed(scored):
        if t.accs > 0 and t.accs < LOW_ACCS:
            streak += 1
        else:
            break
    out.consecutive_low_accs = streak

    if len(scored) >= 2 and scored[-1].accs > 0 and scored[-2].accs > 0:
        out.accs_delta_last = scored[-1].accs - scored[-2].accs

    if out.accs_delta_last is not None:
        if out.accs_delta_last >= 0.05:
            out.trend = "improving"
        elif out.accs_delta_last <= -0.05:
            out.trend = "declining"
        else:
            out.trend = "stable"

    alerts: list[str] = []
    if out.consecutive_low_accs >= STREAK_LOW_ACCS:
        alerts.append("quality_drop")
    last_accs = scored[-1].accs if scored else 0.0
    if (
        out.accs_delta_last is not None
        and out.accs_delta_last <= -ACCS_DROP_ALERT
        and out.accs_rolling_p50 < LOW_ACCS
        and last_accs > 0
        and last_accs < LOW_ACCS
    ):
        alerts.append("alignment_declining")
    if out.topic_shift_count >= 3:
        alerts.append("drift")
    if out.user_correction_turns >= 2 and out.accs_rolling_p50 < LOW_ACCS:
        alerts.append("misunderstanding_loop")

    out.alerts = alerts
    out.alert = alerts[0] if alerts else "none"
    return out


def turns_from_api_rows(
    *,
    score_rows: list[dict[str, Any]],
    user_by_turn: dict[int, str] | None = None,
) -> list[TurnScorePoint]:
    """Build TurnScorePoint list from PHP/API turn_score rows."""
    user_by_turn = user_by_turn or {}
    points: list[TurnScorePoint] = []
    for row in score_rows:
        if not isinstance(row, dict):
            continue
        ti = int(row.get("turn_index") or 0)
        if ti < 1:
            continue
        accs_dims = row.get("accs_dims") or row.get("accs_dims_json") or {}
        if isinstance(accs_dims, str):
            accs_dims = {}
        alignment = 0.0
        if isinstance(accs_dims, dict):
            try:
                alignment = float(accs_dims.get("alignment") or 0.0)
            except (TypeError, ValueError):
                alignment = 0.0
        try:
            accs = float(row.get("accs") or 0.0)
        except (TypeError, ValueError):
            accs = 0.0
        try:
            iqs = float(row.get("iqs") or 0.0)
        except (TypeError, ValueError):
            iqs = 0.0
        points.append(
            TurnScorePoint(
                turn_index=ti,
                assistant_message_id=int(row.get("assistant_message_id") or 0),
                iqs=iqs,
                accs=accs,
                topic_shift=int(row.get("topic_shift") or 0),
                alignment=alignment,
                user_message=str(user_by_turn.get(ti) or ""),
            )
        )
    points.sort(key=lambda p: p.turn_index)
    return points
