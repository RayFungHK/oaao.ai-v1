"""Stable Chat pipeline UI snapshots for SSE + persisted ``meta_json`` (PHP ``assistant_patch``)."""

from __future__ import annotations

import uuid
from typing import Any


def build_minimal_pipeline_snapshot(*, task_id: str | None = None) -> dict[str, Any]:
    """Empty baseline — RAG / vault steps are merged in before LLM streaming."""

    tid = task_id if (task_id and task_id.strip()) else str(uuid.uuid4())

    return {
        "task_id": tid,
        "milestone": {"steps": []},
        "activity": {"lines": []},
        "blocks": [],
        "artifacts": [],
        "pipeline_schema": "oaao_pipeline@v1",
    }


def build_stub_pipeline_snapshot(*, task_id: str | None = None) -> dict[str, Any]:
    """Offline / fixture replay only — not used on live orchestrator chat runs."""

    tid = task_id if (task_id and task_id.strip()) else str(uuid.uuid4())

    steps: list[dict[str, Any]] = [
        {
            "title": "Review the existing proposal",
            "description": "Confirm platform scope and executive messaging.",
            "task_label": "Extract presentation messaging",
            "state": "completed",
            "rail": {
                "badge": "Knowledge retrieved (8)",
                "detail_lines": [
                    "Passage · governance & tenancy isolation",
                    "Passage · workspace routing & chat endpoints",
                    "Passage · orchestrator SSE boundary (PHP stays JSON-only)",
                ],
            },
        },
        {
            "title": "Write a slide-by-slide outline",
            "description": "Structure the management briefing narrative.",
            "task_label": "Draft outline sections",
            "state": "completed",
            "rail": {
                "badge": "Planner routing",
                "detail_lines": ["planning.stub · milestones seeded", "planning.stub · tasks aligned to slots"],
            },
        },
        {
            "title": "Generate presentation slides",
            "description": "Produce downloadable deck and preview.",
            "task_label": "export_ppt_file",
            "state": "active",
            "rail": {
                "badge": "Sandbox · export_ppt_file",
                "detail_lines": ["artifact · OAAO_AI_management_briefing.pptx (stub)"],
            },
        },
    ]

    artifacts: list[dict[str, Any]] = [
        {
            "id": "stub-pptx-1",
            "name": "OAAO_AI_management_briefing.pptx",
            "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "size_bytes": 787000,
            "tool_id": "export_ppt_file",
        },
    ]

    blocks: list[dict[str, Any]] = [
        {
            "type": "artifact_card",
            "title": "Management briefing deck",
            "props": {
                "filename": "OAAO_AI_management_briefing.pptx",
                "subtitle": "Presentation",
                "size_bytes": 787000,
                "badge": "PPTX",
            },
        },
        {
            "type": "task_files_cta",
            "props": {
                "task_id": tid,
                "label": "View all files in this task",
            },
        },
    ]

    activity_lines = [
        "pipeline · stub milestones + rails seeded",
        "rag · retrieval_simulated count=8",
        "sandbox · export_ppt_file queued (stub)",
    ]

    return {
        "task_id": tid,
        "milestone": {"steps": steps},
        "activity": {"lines": activity_lines},
        "blocks": blocks,
        "artifacts": artifacts,
        "pipeline_schema": "oaao_pipeline@v1",
    }


def merge_vault_chat_sources_into_snapshot(
    snap: dict[str, Any],
    vault_source_ids: list[int] | None,
    vault_source_refs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """When PHP forwards composer-selected scopes, surface them in activity lines + top-level fields."""

    clean_refs: list[dict[str, Any]] = []
    for r in vault_source_refs or []:
        if not isinstance(r, dict):
            continue
        kind = str(r.get("kind") or "").lower().strip()
        try:
            nid = int(r.get("id"))
            vid = int(r.get("vault_id"))
        except (TypeError, ValueError):
            continue
        if kind not in {"vault", "folder", "document"} or nid < 1 or vid < 1:
            continue
        if kind == "vault":
            vid = nid
        name = str(r.get("name") or "").strip()
        if len(name) > 512:
            name = name[:512]
        clean_refs.append({"kind": kind, "id": nid, "vault_id": vid, "name": name})
        if len(clean_refs) >= 24:
            break

    if clean_refs:
        out = dict(snap)
        activity = dict(out.get("activity") or {})
        lines = list(activity.get("lines") or [])
        brief = ", ".join(f"{x['kind']}:{x['id']}" for x in clean_refs[:8])
        if len(clean_refs) > 8:
            brief += ", …"
        lines.insert(0, f"vault · chat_scoped_refs={brief}")
        activity["lines"] = lines
        out["activity"] = activity
        out["vault_source_refs"] = clean_refs
        vids = sorted({int(x["vault_id"]) for x in clean_refs if int(x.get("vault_id") or 0) > 0})
        if vids:
            out["vault_source_ids"] = vids
        return out

    if not vault_source_ids:
        return snap
    clean: list[int] = []
    for x in vault_source_ids:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if n > 0:
            clean.append(n)
        if len(clean) >= 24:
            break
    if not clean:
        return snap
    out = dict(snap)
    activity = dict(out.get("activity") or {})
    lines = list(activity.get("lines") or [])
    lines.insert(0, f"vault · chat_scoped_sources={clean}")
    activity["lines"] = lines
    out["activity"] = activity
    out["vault_source_ids"] = clean
    return out
