"""
Post-stream plugins run **outside** the LLM hot path: enqueue after stream completes.

Plugin IDs (e.g. ``iqs``, ``accs``) are **internal product identifiers** — keep them stable in JSON
config; do not overload them with unrelated external service names to avoid confusion in ops/logs.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class PluginContext(BaseModel):
    """Immutable-ish snapshot passed to workers — extend fields as needed."""

    conversation_id: str | None = None
    message_id: str | None = None
    user_id: str | None = None
    purpose_id: str = Field(default="default_chat")
    mode_id: str = Field(default="default")
    pool_id: str = ""
    # Optional serialized refs — avoid stuffing full transcripts here if huge.
    meta: dict[str, Any] = Field(default_factory=dict)


@runtime_checkable
class PostStreamPlugin(Protocol):
    """One callable unit registered under ``plugin_id`` — invoked by queue workers."""

    plugin_id: str

    async def run(self, ctx: PluginContext, *, prompt_rendered: str, endpoint_snapshot: dict[str, Any]) -> None:
        ...
