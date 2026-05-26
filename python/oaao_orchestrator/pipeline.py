from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel, Field

from oaao_orchestrator.queue_pool import QueuePool, spawn_post_stream_jobs


class RunContext(BaseModel):
    """Single ingress contract — every LLM path builds this (modes refine messages only here)."""

    conversation_id: str | None = None
    user_id: str | None = None
    purpose_id: str = "default_chat"
    mode_id: str = "default"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class Pipeline(BaseModel):
    """
    Exactly one code path may call model APIs — stub shows hook order + post-stream enqueue.

    Queue pools are **not** LLM pipelines; they consume ``PluginContext`` + prompts resolved from JSON.

    **Streaming UX:** emit phased ``StreamEnvelope`` rows through ``StreamRun.append`` (agent/MCP/RAG/…)
    before/while LLM deltas — see ``oaao_orchestrator.streaming``.
    """

    model_config = {"arbitrary_types_allowed": True}

    post_stream_pool: QueuePool | None = None

    async def run(self, ctx: RunContext) -> AsyncIterator[dict[str, Any]]:
        # resolve_context → before_messages → before_llm … (implement elsewhere)
        yield {"event": "stub_chunk", "purpose_id": ctx.purpose_id}

        # after_stream: schedule plugins (non-blocking)
        if self.post_stream_pool is not None:
            await spawn_post_stream_jobs(
                pool=self.post_stream_pool,
                plugin_ctx_meta={
                    "conversation_id": ctx.conversation_id,
                    "user_id": ctx.user_id,
                    "purpose_id": ctx.purpose_id,
                    "mode_id": ctx.mode_id,
                },
            )
        yield {"event": "done"}
