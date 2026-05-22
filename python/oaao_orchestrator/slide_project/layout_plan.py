"""Per-deck layout assignment — rules loaded from templates/plan.json."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.slide_project.template_registry import (
    layout_ids,
    max_per_layout,
    middle_rotation,
    plan_rules,
    resolve_layout_id,
    title_hint_layout,
)


def _title_suggests_layout(title: str) -> str | None:
    hinted = title_hint_layout(title)
    if hinted:
        return resolve_layout_id(hinted)
    return None


def diversify_slide_layouts(slides_spec: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ensure each slide has an explicit layout; no adjacent duplicates; cap repetitive templates."""
    if not slides_spec:
        return slides_spec

    rules = plan_rules()
    first_l = str(rules.get("first_layout") or "title_hero")
    second_l = str(rules.get("second_layout") or "two_column")
    last_l = str(rules.get("last_layout") or "summary")
    rotation = middle_rotation()
    caps = max_per_layout()
    valid = layout_ids()

    rows = sorted(slides_spec, key=lambda s: int(s.get("index") or 0))
    total = max(int(r.get("index") or 0) for r in rows)
    layout_counts: dict[str, int] = {}
    prev_layout: str | None = None
    rot_i = 0
    out: list[dict[str, Any]] = []

    for spec in rows:
        row = dict(spec)
        idx = int(row.get("index") or 1)
        title = str(row.get("title") or f"Slide {idx}")
        layout = resolve_layout_id(str(row.get("layout") or "")) or ""
        locked = row.get("layout_locked") is True

        if locked and layout:
            row["layout"] = layout
            layout_counts[layout] = layout_counts.get(layout, 0) + 1
            prev_layout = layout
            out.append(row)
            continue

        if idx == 1:
            layout = resolve_layout_id(first_l) or first_l
        elif idx == total and total > 1:
            layout = resolve_layout_id(last_l) or last_l
        elif idx == 2 and not layout:
            layout = resolve_layout_id(second_l) or second_l
        elif not layout:
            hinted = _title_suggests_layout(title)
            if hinted and hinted not in (first_l, last_l):
                layout = hinted

        if not layout and rotation:
            while True:
                pick = rotation[rot_i % len(rotation)]
                rot_i += 1
                if pick == prev_layout:
                    continue
                cap = caps.get(pick)
                if cap is not None and layout_counts.get(pick, 0) >= cap:
                    continue
                layout = pick
                break

        if layout == prev_layout and rotation:
            for alt in rotation:
                cap = caps.get(alt)
                if alt != prev_layout and (cap is None or layout_counts.get(alt, 0) < cap):
                    layout = alt
                    break

        if layout not in valid:
            layout = resolve_layout_id("title_content") or "title_content"

        row["layout"] = layout
        layout_counts[layout] = layout_counts.get(layout, 0) + 1
        prev_layout = layout
        out.append(row)

    return out
