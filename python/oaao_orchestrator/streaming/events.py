"""
Unified stream vocabulary — UI maps ``phase`` + ``kind`` for activity rail.

These IDs are **internal product vocabulary**; keep stable for persisted replay buffers.

Task pipeline (Manus-style) — see ``docs/backlog/chat-task-pipeline.md``:

- ``phase=task`` + ``kind=start|end|status`` — run-level checklist (``payload.run_task``, ``payload.tasks``).
- ``phase=agent|rag|sandbox|mcp|…`` + ``kind=progress`` — agent-task sub-steps (``payload.agent_task``).
- ``phase=llm`` + ``kind=delta`` — assistant body tokens (unchanged).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

PHASE_TASK = "task"
PHASE_AGENT = "agent"
PHASE_MCP = "mcp"
PHASE_SANDBOX = "sandbox"
PHASE_RAG = "rag"
PHASE_WEB = "web_search"
PHASE_LLM = "llm"
PHASE_SYSTEM = "system"
PHASE_LIVE = "live"

KIND_LIVE_TRANSCRIPT = "live_transcript"
KIND_LIVE_BUBBLE = "live_bubble"
KIND_LIVE_PHASE = "live_phase"
KIND_LIVE_STATS = "live_stats"
KIND_LIVE_MATERIALS = "live_materials"

PHASES: tuple[str, ...] = (
    PHASE_TASK,
    PHASE_AGENT,
    PHASE_MCP,
    PHASE_SANDBOX,
    PHASE_RAG,
    PHASE_WEB,
    PHASE_LLM,
    PHASE_SYSTEM,
    PHASE_LIVE,
)

KIND_STATUS = "status"
KIND_DELTA = "delta"
KIND_START = "start"
KIND_END = "end"
KIND_ERROR = "error"
KIND_PROGRESS = "progress"

KindStatus = Literal["status", "delta", "start", "end", "error", "progress"]


class StreamEnvelope(BaseModel):
    """One logical frame stored & replayed — ``seq`` assigned by ``StreamRun``."""

    phase: str
    kind: KindStatus | str = KIND_STATUS
    step_id: str | None = Field(
        default=None,
        description="Correlates start/end — run task id (rt-*) or agent task id (at-*).",
    )
    text: str | None = Field(default=None, description="Human-readable activity line for the rail.")
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Structured frame body. Common keys: "
            "``tasks`` (checklist + abilities, legacy task_list), "
            "``run_task`` / ``agent`` / ``agent_task`` (two-layer pipeline), "
            "``oaao_pipeline`` (milestone, blocks, artifacts — persist via PHP meta / system/end). "
            "Legacy ``oaao_milestone`` remains backward-compatible."
        ),
    )
