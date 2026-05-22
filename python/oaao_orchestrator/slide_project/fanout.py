"""
SD-4 — expand one slide_designer run task into outline + parallel per-slide + export tasks.
"""

from __future__ import annotations

import os
import re
from typing import Any

from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType

_SLIDE_PHASE_KEY = "slide_phase"


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def fanout_enabled() -> bool:
    raw = (os.environ.get("OAAO_SLIDE_FANOUT") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def detect_slide_page_count(messages: list[dict[str, Any]] | None) -> int:
    """Infer deck size from the latest user message or env default."""
    default = _env_int("OAAO_SLIDE_FANOUT_COUNT", 10)
    text = ""
    for row in reversed(messages or []):
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "").lower() != "user":
            continue
        content = row.get("content")
        if isinstance(content, str) and content.strip():
            text = content
            break
    if not text:
        return max(3, min(default, 20))

    patterns = (
        r"(?:製作|做|生成|建立)?\s*(\d{1,2})\s*(?:頁|张|張|页)(?:\s*(?:的)?\s*(?:簡報|幻灯片|投影片|slide|deck))?",
        r"(\d{1,2})\s*(?:page|pages|slides?)\b",
        r"(?:about|around|~)\s*(\d{1,2})\s*(?:slides?|pages?)",
    )
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                n = int(m.group(1))
                return max(3, min(n, 20))
            except ValueError:
                pass
    return max(3, min(default, 20))


def _is_slide_designer_task(t: RunTaskSpec) -> bool:
    return t.type == RunTaskType.AGENT and (t.agent_kind or "").strip() == "slide_designer"


def _already_fanout_task(t: RunTaskSpec) -> bool:
    phase = (t.params or {}).get(_SLIDE_PHASE_KEY)
    return isinstance(phase, str) and phase.strip() != ""


def format_slide_page_title(
    slide_index: int,
    slide_count: int,
    slide_title: str | None = None,
) -> str:
    """UI label: ``Slide 4/10 — Executive summary``."""
    base = f"Slide {slide_index}/{slide_count}"
    name = (slide_title or "").strip()
    return f"{base} — {name}" if name else base


def apply_manifest_titles_to_page_tasks(
    plan_tasks: list[RunTaskSpec],
    manifest: dict[str, Any],
) -> None:
    """After outline — set per-page run task titles from ``slides_spec``."""
    total = int(manifest.get("slide_count") or 0)
    by_index: dict[int, str] = {}
    for spec in manifest.get("slides_spec") or []:
        if not isinstance(spec, dict):
            continue
        try:
            idx = int(spec.get("index") or 0)
        except (TypeError, ValueError):
            continue
        if idx > 0:
            by_index[idx] = str(spec.get("title") or "").strip()
    if total < 1:
        total = max(by_index.keys()) if by_index else 0
    for t in plan_tasks:
        params = t.params if isinstance(t.params, dict) else {}
        if str(params.get(_SLIDE_PHASE_KEY) or "").strip().lower() != "page":
            continue
        try:
            idx = int(params.get("slide_index") or 0)
        except (TypeError, ValueError):
            idx = 0
        if idx < 1:
            continue
        count = int(params.get("slide_count") or 0) or total or idx
        title = by_index.get(idx) or str(params.get("slide_title") or "").strip()
        t.title = format_slide_page_title(idx, count, title or None)
        if title:
            params["slide_title"] = title
            t.params = params


def expand_slide_designer_fanout(
    tasks: list[RunTaskSpec],
    messages: list[dict[str, Any]] | None = None,
    *,
    continuation: bool = False,
) -> list[RunTaskSpec]:
    """
    Replace a single slide_designer agent row with outline → N parallel pages → export.
    Skips when fanout disabled, continuation resume, task already phased, or no slide_designer row.
    """
    if continuation or not fanout_enabled():
        return tasks

    slide_idxs = [i for i, t in enumerate(tasks) if _is_slide_designer_task(t) and not _already_fanout_task(t)]
    if len(slide_idxs) != 1:
        return tasks

    idx = slide_idxs[0]
    base = tasks[idx]
    page_count = detect_slide_page_count(messages)
    if page_count < 3:
        return tasks

    group = base.id
    ask_params = {k: v for k, v in (base.params or {}).items() if k.startswith("ask") or k == "requires_ask"}

    outline = RunTaskSpec(
        id=f"{group}-outline",
        title=base.title or "Outline slide deck",
        type=RunTaskType.AGENT,
        agent_kind="slide_designer",
        params={**ask_params, _SLIDE_PHASE_KEY: "outline", "slide_group": group, "slide_count": page_count},
    )

    pages: list[RunTaskSpec] = []
    for n in range(1, page_count + 1):
        pages.append(
            RunTaskSpec(
                id=f"{group}-slide-{n:02d}",
                title=format_slide_page_title(n, page_count),
                type=RunTaskType.AGENT,
                agent_kind="slide_designer",
                parallel_ok=True,
                params={
                    _SLIDE_PHASE_KEY: "page",
                    "slide_group": group,
                    "slide_index": n,
                    "slide_count": page_count,
                },
            )
        )

    export_task = RunTaskSpec(
        id=f"{group}-export",
        title="Export slide deck",
        type=RunTaskType.AGENT,
        agent_kind="slide_designer",
        params={_SLIDE_PHASE_KEY: "export", "slide_group": group, "slide_count": page_count},
    )

    out = list(tasks[:idx]) + [outline] + pages + [export_task] + list(tasks[idx + 1 :])
    return out
