"""
FastAPI sidecar — PHP posts resolved endpoint + chat profile; browser reads SSE (token-gated).

Hook chain (baseline): ``before_llm`` empty list — extend like legacy Sidecar pipeline stages.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
import uuid
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from oaao_orchestrator.streaming.events import PHASE_LLM, PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamSessionRegistry

logger = logging.getLogger(__name__)

app = FastAPI(title="oaao orchestrator sidecar", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EndpointPayload(BaseModel):
    """Subset of {@code oaao_endpoint} for ingress — OpenAI-compatible chat completions today; provider taxonomy TBD vs Open Web UI."""

    endpoint_ref: str = ""
    base_url: str
    model: str
    api_key_env: str | None = Field(default=None, description="Environment variable name on this process")


class ChatProfilePayload(BaseModel):
    id: int = 0
    name: str = ""
    type: str = "single"


class ChatRunRequest(BaseModel):
    """
    Ingress from PHP — mirrors ``RunContext`` + resolved rows (no plaintext API keys).
    """

    conversation_id: str | None = None
    user_id: str | None = None
    purpose_id: str = "chat"
    mode_id: str = "default"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = 0.7
    endpoint: EndpointPayload
    chat_profile: ChatProfilePayload = Field(default_factory=ChatProfilePayload)
    assistant_message_id: str | None = None


registry = StreamSessionRegistry()
_stream_tokens: dict[str, str] = {}


def _shared_secret() -> str:
    return os.environ.get("OAAO_ORCH_SHARED_SECRET", "oaao_dev_shared_secret")


def _resolve_api_key(ep: EndpointPayload) -> str | None:
    """Bearer token from sidecar env. When nothing usable is set, return None and omit Authorization (typical for local OpenAI-compatible servers)."""
    name = (ep.api_key_env or "").strip() or "OPENAI_API_KEY"
    v = os.environ.get(name)
    if isinstance(v, str):
        v = v.strip()
        if v:
            return v
    fb = os.environ.get("OPENAI_API_KEY")
    if isinstance(fb, str):
        fb = fb.strip()
        if fb:
            return fb

    return None


def _hostport_looks_http_default(hostport: str) -> bool:
    """Bare URLs without a scheme: use http for loopback / LAN-style hosts, https for hostnames."""
    h = hostport.strip().lower()
    if "@" in h:
        h = h.split("@")[-1]
    host = h.split(":", 1)[0].strip("[]")
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"):
        return True
    if host.endswith(".local"):
        return True
    return bool(re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", host))


def _ensure_url_scheme(base_url: str) -> str:
    """httpx requires an explicit scheme; admins often paste ``host.name/v1`` only."""
    bu = base_url.strip()
    if not bu:
        return bu
    low = bu.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return bu
    hostport = bu.split("/", 1)[0]
    prefix = "http://" if _hostport_looks_http_default(hostport) else "https://"
    return f"{prefix}{bu}"


def _chat_completions_url(base_url: str) -> str:
    bu = _ensure_url_scheme(base_url).rstrip("/")
    if bu.endswith("/v1"):
        return f"{bu}/chat/completions"
    return f"{bu}/v1/chat/completions"


_CLIENT_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)


def _sanitize_client_text(text: str, *, max_len: int = 480) -> str:
    """Remove http(s) URLs from strings shipped over SSE — keep full text in server logs only."""
    s = text.strip()
    if not s:
        return s
    s = _CLIENT_URL_RE.sub("[endpoint]", s)
    if len(s) > max_len:
        return s[: max_len - 1] + "…"
    return s


def _hook_before_llm(req: ChatRunRequest) -> None:
    """Legacy Sidecar-style pipeline hook slot (baseline: no-op)."""
    _ = req


async def _run_llm_stream(*, run_id: str, req: ChatRunRequest) -> None:
    run = registry.get(run_id)
    if run is None:
        return

    t_start = time.perf_counter()
    t_first_token: float | None = None
    out_chars = 0
    completion_tokens: int | None = None
    prompt_tokens: int | None = None

    try:
        _hook_before_llm(req)

        api_key = _resolve_api_key(req.endpoint)
        url = _chat_completions_url(req.endpoint.base_url)
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        body: dict[str, Any] = {
            "model": req.endpoint.model,
            "messages": req.messages,
            "temperature": max(0.0, min(2.0, float(req.temperature))),
            "stream": True,
        }
        if os.environ.get("OAAO_CHAT_STREAM_INCLUDE_USAGE", "1").strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        ):
            body["stream_options"] = {"include_usage": True}

        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="llm_request_start",
                payload={"purpose_id": req.purpose_id, "chat_profile_id": req.chat_profile.id},
            )
        )

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code < 200 or resp.status_code >= 300:
                    txt = await resp.aread()
                    raw = txt.decode("utf-8", errors="replace")[:800]
                    await run.append(
                        StreamEnvelope(
                            phase=PHASE_SYSTEM,
                            kind="error",
                            text=f"upstream_http_{resp.status_code}",
                            payload={"body": _sanitize_client_text(raw, max_len=600)},
                        )
                    )
                    return

                async for line in resp.aiter_lines():
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
                    delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
                    if not isinstance(delta, dict):
                        continue
                    piece = delta.get("content")
                    # OpenAI-compatible servers sometimes emit multimodal ``content`` as a list of parts.
                    if isinstance(piece, list):
                        buf: list[str] = []
                        for seg in piece:
                            if isinstance(seg, dict) and seg.get("type") == "text" and isinstance(seg.get("text"), str):
                                buf.append(seg["text"])
                            elif isinstance(seg, str):
                                buf.append(seg)
                        piece = "".join(buf) if buf else None
                    if isinstance(piece, str) and piece != "":
                        if t_first_token is None:
                            t_first_token = time.perf_counter()
                        out_chars += len(piece)
                        await run.append(
                            StreamEnvelope(phase=PHASE_LLM, kind="delta", text=piece, payload={})
                        )
    except Exception as e:  # noqa: BLE001
        req_url = _chat_completions_url(req.endpoint.base_url)
        logger.exception(
            "llm_stream_failed run_id=%s ref=%s url=%s",
            run_id,
            req.endpoint.endpoint_ref,
            req_url,
        )
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="error",
                text="llm_stream_failed",
                payload={
                    "detail": _sanitize_client_text(str(e)),
                    "exc_type": type(e).__name__,
                    "hint": "If orchestrator runs in Docker and LLM is on your Mac/PC, base_url must reach the host (e.g. http://host.docker.internal:<port>), not http://127.0.0.1.",
                },
            )
        )
    finally:
        t_end = time.perf_counter()
        duration_ms = int((t_end - t_start) * 1000)
        gen_secs = (t_end - t_first_token) if t_first_token is not None else max(t_end - t_start, 1e-9)
        tokens_out: int | None = completion_tokens
        tokens_estimated = False
        if tokens_out is None and out_chars > 0:
            tokens_out = max(1, int(out_chars / 4))
            tokens_estimated = True
        tps: float | None = None
        if tokens_out is not None and gen_secs > 1e-6:
            tps = round(float(tokens_out) / float(gen_secs), 2)

        metrics_payload: dict[str, Any] = {
            "duration_ms": duration_ms,
            "generation_ms": int(gen_secs * 1000),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "tokens_out": tokens_out,
            "tokens_estimated": tokens_estimated,
            "tokens_per_sec": tps,
            "endpoint_ref": req.endpoint.endpoint_ref,
            "model": req.endpoint.model,
            "chat_profile": req.chat_profile.name,
        }
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="end",
                text="run_closed",
                payload=metrics_payload,
            )
        )
        run.mark_done()


@app.post("/v1/runs/chat")
async def start_chat_run(
    req: ChatRunRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, str]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    run_id = str(uuid.uuid4())
    registry.create(run_id)
    token = secrets.token_hex(24)
    _stream_tokens[run_id] = token

    asyncio.create_task(_run_llm_stream(run_id=run_id, req=req))

    return {"run_id": run_id, "stream_token": token}


@app.get("/v1/stream")
async def subscribe_stream(
    run_id: str = Query(...),
    token: str = Query(...),
    since_seq: int = Query(0, ge=0),
) -> StreamingResponse:
    exp = _stream_tokens.get(run_id)
    if not exp or not secrets.compare_digest(exp, token):
        raise HTTPException(status_code=403, detail="bad_stream_token")

    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    async def gen():
        async for chunk in run.subscribe(since_seq):
            yield chunk

    # Proxies (nginx) may buffer SSE unless explicitly disabled; keep connection alive hints for browsers.
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
