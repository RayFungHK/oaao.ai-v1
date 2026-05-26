"""
FastAPI sidecar — PHP posts resolved endpoint + chat profile; browser reads SSE (token-gated).

Hook chain (baseline): ``before_llm`` empty list — extend like legacy Sidecar pipeline stages.

Every chat run emits a stable ``payload.oaao_pipeline`` UI snapshot before upstream LLM deltas
(stub rails today; real RAG / web_search stages extend the same object later). The same snapshot is
attached to ``system/end`` metrics for PHP ``assistant_patch.meta`` persistence.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from oaao_orchestrator.cors_config import resolve_cors_config
from oaao_orchestrator.log_config import configure_oaao_logging
from oaao_orchestrator.research_fetch_poll import research_fetch_poll_loop
from oaao_orchestrator.research_refetch_poll import research_refetch_poll_loop
from oaao_orchestrator.routes.admin import router as _admin_router
from oaao_orchestrator.routes.asr import router as _asr_router
from oaao_orchestrator.routes.health import router as _health_router
from oaao_orchestrator.routes.live import router as _live_router
from oaao_orchestrator.routes.mine import router as _mine_router
from oaao_orchestrator.routes.research import router as _research_router
from oaao_orchestrator.routes.runs import router as _runs_router
from oaao_orchestrator.routes.skills import router as _skills_router
from oaao_orchestrator.routes.slides import router as _slides_router
from oaao_orchestrator.routes.turn_scores import router as _turn_scores_router
from oaao_orchestrator.vault_job_poll import vault_job_poll_loop

configure_oaao_logging()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    from oaao_orchestrator.evaluation.evolution_collections import (
        ensure_evolution_collections,
    )
    from oaao_orchestrator.post_stream_pool import (
        start_post_stream_pools,
        stop_post_stream_pools,
    )

    poll_task = asyncio.create_task(vault_job_poll_loop())
    research_poll_task = asyncio.create_task(research_fetch_poll_loop())
    research_refetch_poll_task = asyncio.create_task(research_refetch_poll_loop())
    await start_post_stream_pools()
    try:
        await ensure_evolution_collections()
    except Exception:  # noqa: BLE001
        logger.debug("ensure_evolution_collections skipped", exc_info=True)
    try:
        from oaao_orchestrator.crystallization.bootstrap import (
            bootstrap_crystallized_skills,
        )

        await bootstrap_crystallized_skills()
    except Exception:  # noqa: BLE001
        logger.debug("bootstrap_crystallized_skills skipped", exc_info=True)
    yield
    await stop_post_stream_pools()
    poll_task.cancel()
    research_poll_task.cancel()
    research_refetch_poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass
    try:
        await research_poll_task
    except asyncio.CancelledError:
        pass
    try:
        await research_refetch_poll_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="oaao orchestrator sidecar", version="0.1.0", lifespan=_lifespan)

# W10-S2 — CORS allowlist. Single source of truth lives in `cors_config.py`
# (unit-tested in `tests/test_cors_allowlist.py`). Defaults cover localhost on
# ports 80/8080/9080; override via `OAAO_CORS_ALLOWED_ORIGINS`.
_cors_cfg = resolve_cors_config()
logger.info(
    "cors_config origins=%s credentials=%s wildcard=%s",
    list(_cors_cfg.origins),
    _cors_cfg.allow_credentials,
    _cors_cfg.wildcard,
)
app.add_middleware(CORSMiddleware, **_cors_cfg.as_middleware_kwargs())


# EndpointPayload lives in routes/_shared_models.py so route modules can import
# it without circular deps on app.py. Re-exported here for back-compat.
from oaao_orchestrator.routes._shared_models import EndpointPayload  # noqa: E402


class ChatProfilePayload(BaseModel):
    id: int = 0
    name: str = ""
    type: str = "single"


class VaultSourceRef(BaseModel):
    """Structured chat retrieval scope forwarded from SPA ({@code vault_source_refs})."""

    kind: Literal["vault", "folder", "document"]
    id: int = Field(ge=1)
    vault_id: int = Field(ge=1)
    name: str = ""


class ChatRunRequest(BaseModel):
    """
    Ingress from PHP — mirrors ``RunContext`` + resolved rows (no plaintext API keys).

    **Bootstrap contract:** all MDM for this run must arrive in this payload; the sidecar must not
    call PHP for vault profiles, endpoints, or scope during execution (see ``php_boundary``).
    """

    conversation_id: str | None = None
    user_id: str | None = None
    purpose_id: str = "chat"
    mode_id: str = "default"
    planner_mode_id: str = Field(
        default="default",
        description="Planner expansion mode — default | tot | ddtree (distinct from desk/default UI mode_id).",
    )
    messages: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = 0.7
    max_tokens: int | None = Field(
        default=None,
        ge=1,
        le=128_000,
        description="Chat completion max_tokens — from profile/endpoint config_json or OAAO_CHAT_MAX_TOKENS.",
    )
    endpoint: EndpointPayload
    chat_profile: ChatProfilePayload = Field(default_factory=ChatProfilePayload)
    assistant_message_id: str | None = None
    vault_source_ids: list[int] = Field(default_factory=list)
    vault_source_refs: list[VaultSourceRef] = Field(default_factory=list)
    vault_auto_rag: bool = False
    workspace_id: int | None = None
    vault_retrieval_profiles: list[dict[str, Any]] = Field(default_factory=list)
    vault_scope_documents: dict[str, list[int]] = Field(
        default_factory=dict,
        description="Per-vault document id allow-list from chat composer refs (string vault_id keys).",
    )
    vault_document_catalog: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description='Citation labels keyed "{vault_id}:{document_id}" — file_name, vault_name, path.',
    )
    vault_rag: dict[str, Any] | None = Field(
        default=None,
        description="Retrieval tuning from Settings → RAG (qdrant_limit, min_score, boosts, …).",
    )
    tenant_id: int | None = None
    endpoint_id: int | None = Field(default=None, ge=1)
    chat_endpoint_id: int | None = Field(default=None, ge=1)
    purpose_key: str | None = None
    embedding: dict[str, Any] | None = None
    rerank: dict[str, Any] | None = None
    chat_attachments: list[dict[str, Any]] = Field(default_factory=list)
    asr: dict[str, Any] | None = None
    polish: dict[str, Any] | None = None
    glossary: dict[str, Any] | None = None
    uiqe: dict[str, Any] | None = Field(
        default=None,
        description="Resolved uiqe.* purpose for post-stream IQS/ACCS workers.",
    )
    planner: dict[str, Any] | None = Field(
        default=None,
        description="Resolved planning.* purpose for task planner LLM (Settings → Task planner).",
    )
    allowed_agents: list[str] = Field(
        default_factory=list,
        description="Agent kinds permitted this run (sandbox_code, slides, …) — drives planner abilities.",
    )
    agent_catalog: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Planner hints per agent_kind from PHP PlannerAgentRegister (name, description, planner_hint).",
    )
    run_planner_mode: str | None = Field(
        default=None,
        description="llm | stub — from Settings → Task planner (planning.* meta); env fallback when omitted.",
    )
    slide_designer: dict[str, Any] | None = Field(
        default=None,
        description="Slide project storage root, resume/continuation — from PHP send.",
    )
    conversation_materials: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Recent slide projects + file materials for planner context (SD-5).",
    )
    conversation_material_grounding: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Prior-turn material bodies (vault RAG brief, deck_outline.md, …) for regenerate/retry.",
    )
    reuse_grounding_message_id: int | None = Field(
        default=None,
        description="Assistant message id — load materials indexed from that turn (retry/regenerate).",
    )
    skills_catalog: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Micro skills catalog — bound_template, conversation, … from PHP MicroSkillCatalog.",
    )
    tool_servers: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Registered OpenAPI tool servers from PHP tool_server.register.",
    )
    openai_tools: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Pre-resolved OpenAI tools[] merged at LLM stream time.",
    )
    run_principal: str | None = Field(
        default=None,
        description="HMAC-signed run identity from PHP send — validates user/conversation/message for the whole run.",
    )
    is_new_conversation: bool = Field(
        default=False,
        description="True when PHP just created this conversation row — enables auto-title.",
    )




# Streaming state moved to streaming_state.py so routes/runs.py can share it
# without creating an import cycle with app.py.
from oaao_orchestrator.streaming_state import _stream_tokens, registry  # noqa: E402


def _shared_secret() -> str:
    from oaao_orchestrator._internal_secret import require_internal_secret

    return require_internal_secret()


def _php_vault_api_base() -> str:
    return (
        os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL", "http://web/vault/api").strip().rstrip("/")
    )


async def _report_usage_to_php(
    *, tenant_id: int | None, event_kind: str, meta: dict[str, Any]
) -> None:
    from oaao_orchestrator.php_boundary import assert_php_http_allowed

    if tenant_id is None or tenant_id < 1:
        return
    url = f"{_php_vault_api_base()}/usage_record"
    assert_php_http_allowed(url, context="usage_record")
    body: dict[str, Any] = {
        "tenant_id": tenant_id,
        "event_kind": event_kind,
        "meta": meta,
    }
    if event_kind == "chat.completion":
        pt = meta.get("prompt_tokens")
        ct = meta.get("completion_tokens") or meta.get("tokens_out")
        total = 0.0
        if pt is not None or ct is not None:
            try:
                total = float(int(pt or 0) + int(ct or 0))
            except (TypeError, ValueError):
                total = 0.0
        elif ct is not None:
            try:
                total = float(int(ct))
            except (TypeError, ValueError):
                total = 0.0
        if total > 0:
            body["quantity"] = total
            body["unit"] = "tokens"
    pk = meta.get("purpose_key")
    if isinstance(pk, str) and pk.strip():
        body["purpose_key"] = pk.strip()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-OAAO-Internal-Token": _shared_secret(),
                },
                json=body,
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("usage_record callback failed: %s", exc)


from oaao_orchestrator.endpoint_keys import (  # noqa: E402
    resolve_api_key as _resolve_api_key,
)
from oaao_orchestrator.endpoint_keys import (  # noqa: E402
    resolve_api_key_env_dict as _resolve_api_key_env_dict,
)


def _resolve_planner_llm(req: Any) -> tuple[str, str | None, str]:
    """Task planner URL/key/model — planning.* purpose when configured, else chat endpoint."""
    planner = getattr(req, "planner", None)
    if isinstance(planner, dict):
        base = str(planner.get("base_url") or "").strip()
        model = str(planner.get("model") or "").strip()
        if base and model:
            return _chat_completions_url(base), _resolve_api_key_env_dict(planner), model
    ep = req.endpoint
    return _chat_completions_url(ep.base_url), _resolve_api_key(ep), str(ep.model or "")


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
    from oaao_orchestrator.run_executor import execute_chat_run

    await execute_chat_run(run_id=run_id, req=req, registry=registry)


# W5-S1 — health + admin routes extracted to oaao_orchestrator.routes.* and
# mounted here. The duplicated X-OAAO-Internal-Token guard now lives in
# routes._deps.require_internal_token. The historical blocks that occupied
# lines 555-718 of this file were moved verbatim; behaviour is preserved.
app.include_router(_health_router)
app.include_router(_admin_router)
app.include_router(_asr_router)
app.include_router(_mine_router)
app.include_router(_research_router)
app.include_router(_live_router)
app.include_router(_runs_router)
app.include_router(_skills_router)
app.include_router(_slides_router)
app.include_router(_turn_scores_router)


@app.post("/v1/runs/chat")
async def start_chat_run(
    req: ChatRunRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, str]:
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    run_id = str(uuid.uuid4())
    registry.create(run_id)
    token = secrets.token_hex(24)
    _stream_tokens[run_id] = token

    asyncio.create_task(_run_llm_stream(run_id=run_id, req=req))  # noqa: RUF006

    return {"run_id": run_id, "stream_token": token}

