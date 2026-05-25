"""LLM chat completion stream with OpenAPI tool-call loop."""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Awaitable

import httpx

from oaao_orchestrator.tools.caller import invoke_openapi_tool

logger = logging.getLogger(__name__)

StreamAppend = Callable[[str], Awaitable[None]]
MAX_TOOL_ROUNDS = 3


def _merge_tool_call_delta(acc: dict[int, dict[str, Any]], delta_calls: list[Any]) -> None:
    for tc in delta_calls:
        if not isinstance(tc, dict):
            continue
        idx = int(tc.get("index") or 0)
        row = acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
        if isinstance(tc.get("id"), str):
            row["id"] = tc["id"]
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        if isinstance(fn.get("name"), str):
            row["name"] = fn["name"]
        if isinstance(fn.get("arguments"), str):
            row["arguments"] += fn["arguments"]


async def stream_chat_with_tools(
    *,
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    messages: list[dict[str, Any]],
    on_delta: StreamAppend,
    cancelled: Callable[[], bool],
) -> tuple[str, str | None, int, int | None, int | None]:
    """
    Stream chat completions; execute tool calls between rounds.

    Returns ``(assistant_text, finish_reason, out_chars, completion_tokens, prompt_tokens)``.
    """
    convo = list(messages)
    all_text_parts: list[str] = []
    out_chars = 0
    completion_tokens: int | None = None
    prompt_tokens: int | None = None
    finish_reason: str | None = None

    for _round in range(MAX_TOOL_ROUNDS):
        if cancelled():
            break
        round_body = {**body, "messages": convo, "stream": True}
        round_text: list[str] = []
        tool_acc: dict[int, dict[str, Any]] = {}
        finish_reason = None

        async with client.stream("POST", url, headers=headers, json=round_body) as resp:
            if resp.status_code < 200 or resp.status_code >= 300:
                txt = await resp.aread()
                raise httpx.HTTPStatusError(
                    f"upstream_http_{resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
            async for line in resp.aiter_lines():
                if cancelled():
                    break
                if not line or not line.startswith("data:"):
                    continue
                data_s = line[5:].strip()
                if data_s == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_s)
                except json.JSONDecodeError:
                    continue
                if isinstance(chunk, dict):
                    usage = chunk.get("usage")
                    if isinstance(usage, dict):
                        ct = usage.get("completion_tokens")
                        pt = usage.get("prompt_tokens")
                        if isinstance(ct, int):
                            completion_tokens = ct
                        if isinstance(pt, int):
                            prompt_tokens = pt
                choices = chunk.get("choices") if isinstance(chunk, dict) else None
                if not isinstance(choices, list) or not choices:
                    continue
                choice0 = choices[0] if isinstance(choices[0], dict) else {}
                fr = choice0.get("finish_reason")
                if isinstance(fr, str) and fr.strip():
                    finish_reason = fr.strip()
                delta = choice0.get("delta") if isinstance(choice0, dict) else None
                if not isinstance(delta, dict):
                    continue
                tc_delta = delta.get("tool_calls")
                if isinstance(tc_delta, list):
                    _merge_tool_call_delta(tool_acc, tc_delta)
                piece = delta.get("content")
                if isinstance(piece, str) and piece:
                    round_text.append(piece)
                    out_chars += len(piece)
                    await on_delta(piece)

        assistant_content = "".join(round_text)
        if tool_acc and finish_reason == "tool_calls":
            convo.append(
                {
                    "role": "assistant",
                    "content": assistant_content or None,
                    "tool_calls": [
                        {
                            "id": row.get("id") or f"call_{idx}",
                            "type": "function",
                            "function": {"name": row.get("name"), "arguments": row.get("arguments") or "{}"},
                        }
                        for idx, row in sorted(tool_acc.items())
                        if row.get("name")
                    ],
                }
            )
            for idx, row in sorted(tool_acc.items()):
                name = str(row.get("name") or "").strip()
                if not name:
                    continue
                result = await invoke_openapi_tool(name, row.get("arguments") or "{}")
                convo.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(row.get("id") or f"call_{idx}"),
                        "content": result,
                    }
                )
            continue

        if assistant_content:
            all_text_parts.append(assistant_content)
        break

    return "".join(all_text_parts), finish_reason, out_chars, completion_tokens, prompt_tokens
