"""Internal metric plugin ``accs`` — placeholder implementation."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.plugins.spec import PluginContext

logger = logging.getLogger(__name__)


class AccsPlugin:
    plugin_id = "accs"

    async def run(self, ctx: PluginContext, *, prompt_rendered: str, endpoint_snapshot: dict[str, Any]) -> None:
        logger.info(
            "accs stub run pool=%s conversation_id=%s assistant_message_id=%s prompt_len=%s",
            ctx.pool_id,
            (ctx.meta or {}).get("conversation_id"),
            (ctx.meta or {}).get("assistant_message_id"),
            len(prompt_rendered or ""),
        )
        _ = endpoint_snapshot
        # TODO: persist ACCS — keep naming scoped to this codebase only.
