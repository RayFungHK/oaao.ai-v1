"""Dot-path extraction from JSON payloads."""

from __future__ import annotations

from typing import Any


def get_json_path(data: Any, path: str) -> Any:
    path = (path or "").strip()
    if not path:
        return data
    cur: Any = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list):
            try:
                idx = int(part)
                cur = cur[idx]
            except (ValueError, IndexError, TypeError):
                return None
        else:
            return None
    return cur


def rows_from_json_path(data: Any, path: str) -> list[dict[str, Any]]:
    node = get_json_path(data, path) if path else data
    if isinstance(node, list):
        return [r for r in node if isinstance(r, dict)]
    if isinstance(node, dict):
        return [node]
    return []
