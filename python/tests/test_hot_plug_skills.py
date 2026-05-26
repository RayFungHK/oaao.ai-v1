"""Tests for hot-plug skills manifest → OpenAI tools + invocation."""

from __future__ import annotations

import json

import pytest

from oaao_orchestrator.skills.hot_plug import (
    invoke_hot_plug_skill,
    openai_tools_from_hot_plug_skills,
    register_request_hot_plug_skills,
)
from oaao_orchestrator.tools.registry import merge_openai_tools, skill_to_openai_tool


def test_skill_to_openai_tool_basic() -> None:
    tool = skill_to_openai_tool(
        {
            "id": "summarize",
            "description": "Summarize text",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        }
    )
    assert tool["type"] == "function"
    fn = tool["function"]
    assert fn["name"] == "summarize"
    assert fn["description"] == "Summarize text"
    assert fn["parameters"]["required"] == ["text"]


def test_hot_plug_merge_into_openai_tools() -> None:
    register_request_hot_plug_skills(
        [
            {
                "id": "code_review",
                "description": "Review code",
                "handler": "instruction",
                "instruction": "Review: {{code}}",
                "parameters": {
                    "type": "object",
                    "properties": {"code": {"type": "string"}},
                },
                "allowed_purposes": ["chat"],
            }
        ]
    )
    merged = merge_openai_tools([], purpose_id="chat")
    names = [t["function"]["name"] for t in merged]
    assert "code_review" in names


def test_openai_tools_respects_purpose_filter() -> None:
    register_request_hot_plug_skills(
        [
            {
                "id": "chat_only",
                "description": "Chat skill",
                "allowed_purposes": ["chat"],
            },
            {
                "id": "plan_only",
                "description": "Plan skill",
                "allowed_purposes": ["planning"],
            },
        ]
    )
    chat_tools = openai_tools_from_hot_plug_skills(purpose_id="chat")
    chat_names = {t["function"]["name"] for t in chat_tools}
    assert "chat_only" in chat_names
    assert "plan_only" not in chat_names


@pytest.mark.asyncio
async def test_invoke_instruction_handler() -> None:
    register_request_hot_plug_skills(
        [
            {
                "id": "hello_skill",
                "handler": "instruction",
                "instruction": "Say hello to {{name}}",
            }
        ]
    )
    raw = await invoke_hot_plug_skill("hello_skill", {"name": "Ray"})
    assert raw is not None
    data = json.loads(raw)
    assert "hello to Ray" in data["instruction"]
