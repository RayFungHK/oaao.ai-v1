"""Tests for OpenAPI → OpenAI tools adapter."""

from __future__ import annotations

from oaao_orchestrator.tools.openapi_adapter import openapi_to_openai_tools


def test_openapi_get_path_converts() -> None:
    spec = {
        "openapi": "3.0.0",
        "paths": {
            "/search": {
                "get": {
                    "operationId": "webSearch",
                    "summary": "Search the web",
                    "parameters": [
                        {"name": "q", "in": "query", "required": True, "schema": {"type": "string"}},
                    ],
                }
            }
        },
    }
    tools = openapi_to_openai_tools(spec)
    assert len(tools) == 1
    fn = tools[0]["function"]
    assert fn["name"] == "webSearch"
    assert "q" in fn["parameters"]["properties"]


def test_openapi_post_body_schema() -> None:
    spec = {
        "paths": {
            "/items": {
                "post": {
                    "operationId": "createItem",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {"title": {"type": "string"}},
                                    "required": ["title"],
                                }
                            }
                        }
                    },
                }
            }
        }
    }
    tools = openapi_to_openai_tools(spec)
    assert tools[0]["function"]["parameters"]["required"] == ["title"]


def test_empty_spec_returns_empty() -> None:
    assert openapi_to_openai_tools({}) == []
    assert openapi_to_openai_tools({"paths": {}}) == []
