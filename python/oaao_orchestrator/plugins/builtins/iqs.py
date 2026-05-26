"""Internal metric plugin ``iqs`` — UIQE LLM scoring (persist in Phase 3)."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.plugins.post_stream_runner import run_scoring_plugin
from oaao_orchestrator.plugins.spec import PluginContext


class IqsPlugin:
    plugin_id = "iqs"

    async def run(
        self, ctx: PluginContext, *, prompt_rendered: str, endpoint_snapshot: dict[str, Any]
    ) -> None:
        await run_scoring_plugin(
            self.plugin_id,
            ctx,
            prompt_rendered=prompt_rendered,
            endpoint_snapshot=endpoint_snapshot,
        )
