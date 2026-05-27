"""Top-20 #6 phase 8 — LLM_STREAM dispatch branch extracted from run_executor.

Owns the ``elif run_task.type == RunTaskType.LLM_STREAM`` block of
``execute_chat_run`` — upstream OpenAI-compatible chat-completions streaming
(tool-loop or plain SSE), delta forwarding, finish-reason capture, token
accounting, and the HTTP-error early-return path.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from oaao_orchestrator.run_executor_timing import finalize_run_task_timing
from oaao_orchestrator.run_executor_upstream import (
    apply_upstream_sampling,
    llm_stream_timeout,
    resolve_max_tokens,
)
from oaao_orchestrator.run_executor_vault_rag import inject_compose_vault_awareness
from oaao_orchestrator.streaming.events import (
    PHASE_LLM,
    PHASE_SYSTEM,
    StreamEnvelope,
)
from oaao_orchestrator.tasks.stream_emit import emit_run_task_end

logger = logging.getLogger(__name__)


@dataclass
class LLMStreamState:
    """Mutable per-run scalars threaded through the LLM_STREAM branch.

    Caller seeds the dataclass from its locals before the call and reads
    the fields back after (``streamed_parts`` is a list — mutated in place;
    the scalars need explicit write-back).
    """

    streamed_parts: list[str]
    t_first_token: float | None
    out_chars: int
    completion_tokens: int | None
    prompt_tokens: int | None
    finish_reason: str | None
    task_failed: bool
    run_failed: bool


async def handle_llm_stream_task(
    *,
    state: LLMStreamState,
    run,
    req,
    run_ctx,
    run_task,
    plan,
    allowed_agents,
    messages_for_llm: list[dict],
    pipeline_snap: dict | None,
    pipeline_timing: dict,
    task_t0: float,
    api_key: str | None,
) -> bool:
    """Execute one LLM_STREAM run_task.

    Returns ``abort``: when True the caller must ``return`` from
    ``execute_chat_run`` (HTTP error path that has already emitted the
    failure envelope + ``emit_run_task_end`` with ``failed=True``).
    """

    from oaao_orchestrator.chat_helpers import (
        _chat_completions_url,
        upstream_http_error_payload,
    )

    inject_compose_vault_awareness(
        messages_for_llm,
        req=req,
        vault_ran=bool(run_ctx.extra.get("vault_rag_ran")),
        passage_count=int(run_ctx.extra.get("vault_rag_passage_count") or 0),
    )
    run_ctx.messages = list(messages_for_llm)
    _att_sys_msgs = [
        i
        for i, m in enumerate(messages_for_llm)
        if isinstance(m, dict)
        and str(m.get("role") or "") == "system"
        and "attached files" in str(m.get("content") or "").lower()
    ]
    logger.info(
        "chat_attachments: pre-LLM messages total=%s system=%s att_system_idx=%s att_sys_chars=%s",
        len(messages_for_llm),
        sum(
            1
            for m in messages_for_llm
            if isinstance(m, dict) and str(m.get("role") or "") == "system"
        ),
        _att_sys_msgs,
        [
            len(str(messages_for_llm[i].get("content") or ""))
            for i in _att_sys_msgs
        ],
    )
    url = _chat_completions_url(req.endpoint.base_url)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body: dict[str, Any] = {
        "model": req.endpoint.model,
        "messages": messages_for_llm,
        "temperature": max(0.0, min(2.0, float(req.temperature))),
        "stream": True,
    }
    max_tokens = resolve_max_tokens(req)
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    from oaao_orchestrator.tools.registry import merge_openai_tools

    merged_tools = merge_openai_tools(
        getattr(req, "openai_tools", None) or [],
        purpose_id=str(getattr(req, "purpose_id", "") or "chat"),
    )
    if merged_tools:
        body["tools"] = merged_tools
    apply_upstream_sampling(body)
    if os.environ.get(
        "OAAO_CHAT_STREAM_INCLUDE_USAGE", "1"
    ).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    ):
        body["stream_options"] = {"include_usage": True}

    if pipeline_snap:
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="pipeline_stub",
                payload={"oaao_pipeline": pipeline_snap},
            )
        )

    use_tool_loop = bool(merged_tools)

    async def _emit_llm_delta(piece: str) -> None:
        if state.t_first_token is None:
            state.t_first_token = time.perf_counter()
        state.streamed_parts.append(piece)
        await run.append(
            StreamEnvelope(phase=PHASE_LLM, kind="delta", text=piece, payload={})
        )

    async with httpx.AsyncClient(timeout=llm_stream_timeout()) as client:
        if use_tool_loop:
            from oaao_orchestrator.llm_tool_loop import stream_chat_with_tools

            try:
                (
                    _tool_text,
                    fr_out,
                    tool_out_chars,
                    ct_out,
                    pt_out,
                ) = await stream_chat_with_tools(
                    client=client,
                    url=url,
                    headers=headers,
                    body=body,
                    messages=list(messages_for_llm),
                    on_delta=_emit_llm_delta,
                    cancelled=lambda: run.cancelled,
                )
                state.finish_reason = fr_out
                state.completion_tokens = ct_out
                state.prompt_tokens = pt_out
                state.out_chars += tool_out_chars
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code if exc.response is not None else 0
                raw = (exc.response.text if exc.response is not None else str(exc))[:800]
                logger.warning(
                    "upstream_http_error status=%s url=%s ref=%s",
                    status,
                    url,
                    getattr(req.endpoint, "endpoint_ref", ""),
                )
                err_payload = upstream_http_error_payload(
                    status,
                    raw,
                    endpoint_base_url=str(getattr(req.endpoint, "base_url", "") or ""),
                    endpoint_ref=str(getattr(req.endpoint, "endpoint_ref", "") or ""),
                    endpoint_model=str(getattr(req.endpoint, "model", "") or ""),
                )
                await run.append(
                    StreamEnvelope(
                        phase=PHASE_SYSTEM,
                        kind="error",
                        text=f"upstream_http_{status}",
                        payload=err_payload,
                    )
                )
                state.task_failed = True
                state.run_failed = True
                llm_ms = finalize_run_task_timing(
                    pipeline_timing=pipeline_timing,
                    run_task=run_task,
                    task_t0=task_t0,
                )
                await emit_run_task_end(
                    run,
                    plan,
                    run_task,
                    allowed_agents=allowed_agents,
                    pipeline_snap=pipeline_snap,
                    failed=True,
                    duration_ms=llm_ms,
                )
                return True
        else:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code < 200 or resp.status_code >= 300:
                    txt = await resp.aread()
                    raw = txt.decode("utf-8", errors="replace")[:800]
                    logger.warning(
                        "upstream_http_error status=%s url=%s ref=%s",
                        resp.status_code,
                        url,
                        getattr(req.endpoint, "endpoint_ref", ""),
                    )
                    err_payload = upstream_http_error_payload(
                        resp.status_code,
                        raw,
                        endpoint_base_url=str(getattr(req.endpoint, "base_url", "") or ""),
                        endpoint_ref=str(getattr(req.endpoint, "endpoint_ref", "") or ""),
                        endpoint_model=str(getattr(req.endpoint, "model", "") or ""),
                    )
                    await run.append(
                        StreamEnvelope(
                            phase=PHASE_SYSTEM,
                            kind="error",
                            text=f"upstream_http_{resp.status_code}",
                            payload=err_payload,
                        )
                    )
                    state.task_failed = True
                    state.run_failed = True
                    llm_ms = finalize_run_task_timing(
                        pipeline_timing=pipeline_timing,
                        run_task=run_task,
                        task_t0=task_t0,
                    )
                    await emit_run_task_end(
                        run,
                        plan,
                        run_task,
                        allowed_agents=allowed_agents,
                        pipeline_snap=pipeline_snap,
                        failed=True,
                        duration_ms=llm_ms,
                    )
                    return True

                async for line in resp.aiter_lines():
                    if run.cancelled:
                        state.run_failed = True
                        state.task_failed = True
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
                                state.completion_tokens = ct
                            if isinstance(pt, int):
                                state.prompt_tokens = pt
                    choices = chunk.get("choices") if isinstance(chunk, dict) else None
                    if not isinstance(choices, list) or not choices:
                        continue
                    choice0 = choices[0] if isinstance(choices[0], dict) else {}
                    fr = choice0.get("finish_reason")
                    if isinstance(fr, str) and fr.strip():
                        state.finish_reason = fr.strip()
                    delta = choice0.get("delta") if isinstance(choice0, dict) else None
                    if not isinstance(delta, dict):
                        continue
                    piece = delta.get("content")
                    if isinstance(piece, list):
                        buf: list[str] = []
                        for seg in piece:
                            if (
                                isinstance(seg, dict)
                                and seg.get("type") == "text"
                                and isinstance(seg.get("text"), str)
                            ):
                                buf.append(seg["text"])
                            elif isinstance(seg, str):
                                buf.append(seg)
                        piece = "".join(buf) if buf else None
                    if isinstance(piece, str) and piece != "":
                        if state.t_first_token is None:
                            state.t_first_token = time.perf_counter()
                        state.out_chars += len(piece)
                        state.streamed_parts.append(piece)
                        await run.append(
                            StreamEnvelope(
                                phase=PHASE_LLM,
                                kind="delta",
                                text=piece,
                                payload={},
                            )
                        )

    if state.finish_reason == "length":
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="llm_truncated",
                payload={"finish_reason": state.finish_reason},
            )
        )
    return False
