"""WS-1-S6 — resolve scheduled refresh settings from knowledge payload or env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class KnowledgeRefreshSettings:
    scheduled_enabled: bool = True
    interval_hours: float = 168.0
    classify_after: bool = True
    merge_recall: bool = True
    do_not_search: tuple[str, ...] = ()


def refresh_settings_from_knowledge(
    knowledge: dict[str, Any] | None,
) -> KnowledgeRefreshSettings:
    raw: dict[str, Any] = {}
    if isinstance(knowledge, dict):
        nested = knowledge.get("refresh")
        if isinstance(nested, dict):
            raw = nested

    def _bool(key: str, default: bool) -> bool:
        if key not in raw and key.replace("_", "") not in raw:
            return default
        v = raw.get(key)
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() not in ("0", "false", "no", "off")
        return bool(v)

    interval = raw.get("interval_hours") or raw.get("refresh_interval_hours")
    try:
        interval_h = float(interval) if interval is not None else float(
            os.environ.get("OAAO_KNOWLEDGE_REFRESH_INTERVAL_HOURS") or "168"
        )
    except (TypeError, ValueError):
        interval_h = 168.0
    interval_h = max(1.0, min(720.0, interval_h))

    dns: list[str] = []
    raw_dns = raw.get("do_not_search")
    if isinstance(raw_dns, list):
        for item in raw_dns:
            s = str(item).strip()
            if s and s.lower() not in {d.lower() for d in dns}:
                dns.append(s)
            if len(dns) >= 24:
                break

    scheduled_default = os.environ.get("OAAO_KNOWLEDGE_REFRESH_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )

    return KnowledgeRefreshSettings(
        scheduled_enabled=_bool("scheduled_enabled", scheduled_default),
        interval_hours=interval_h,
        classify_after=_bool("classify_after", True),
        merge_recall=_bool("merge_recall", True),
        do_not_search=tuple(dns),
    )
