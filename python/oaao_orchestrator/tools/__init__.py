"""Tool servers — OpenAPI → OpenAI tools schema (OpenWebUI Gap O-1)."""

from __future__ import annotations

from oaao_orchestrator.tools.openapi_adapter import openapi_to_openai_tools
from oaao_orchestrator.tools.registry import (
    ToolServerSpec,
    load_tool_servers_from_env,
    merge_openai_tools,
    skill_to_openai_tool,
)

__all__ = [
    "ToolServerSpec",
    "load_tool_servers_from_env",
    "merge_openai_tools",
    "openapi_to_openai_tools",
    "skill_to_openai_tool",
]
