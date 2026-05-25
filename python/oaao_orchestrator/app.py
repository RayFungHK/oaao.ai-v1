"""
FastAPI sidecar — PHP posts resolved endpoint + chat profile; browser reads SSE (token-gated).

Hook chain (baseline): ``before_llm`` empty list — extend like legacy Sidecar pipeline stages.

Every chat run emits a stable ``payload.oaao_pipeline`` UI snapshot before upstream LLM deltas
(stub rails today; real RAG / web_search stages extend the same object later). The same snapshot is
attached to ``system/end`` metrics for PHP ``assistant_patch.meta`` persistence.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import secrets
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from oaao_orchestrator.agent_ask import ASK_DECISION_SKIP
from oaao_orchestrator.asr_common import run_asr_pipeline_on_file
from oaao_orchestrator.funasr_ops import ensure_funasr, funasr_status
from oaao_orchestrator.streaming.session import StreamSessionRegistry
from oaao_orchestrator.vault_job_poll import vault_job_poll_loop

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    from oaao_orchestrator.evaluation.evolution_collections import ensure_evolution_collections  # noqa: PLC0415
    from oaao_orchestrator.post_stream_pool import start_post_stream_pools, stop_post_stream_pools  # noqa: PLC0415

    poll_task = asyncio.create_task(vault_job_poll_loop())
    await start_post_stream_pools()
    try:
        await ensure_evolution_collections()
    except Exception:
        logger.debug("ensure_evolution_collections skipped", exc_info=True)
    try:
        from oaao_orchestrator.crystallization.bootstrap import bootstrap_crystallized_skills  # noqa: PLC0415

        await bootstrap_crystallized_skills()
    except Exception:
        logger.debug("bootstrap_crystallized_skills skipped", exc_info=True)
    yield
    await stop_post_stream_pools()
    poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="oaao orchestrator sidecar", version="0.1.0", lifespan=_lifespan)

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
    endpoint_id: int | None = Field(default=None, ge=1)
    base_url: str
    model: str
    api_key_env: str | None = Field(default=None, description="Environment variable name on this process")


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


class SkillsDiscoverRequest(BaseModel):
    user_message: str = ""
    conversation_excerpt: str = ""
    skills_catalog: list[dict[str, Any]] = Field(default_factory=list)
    endpoint: EndpointPayload


class AsrTranscribeRequest(BaseModel):
    workspace_id: int | None = None
    audio_base64: str = ""
    mime_type: str = "audio/webm"
    polish_enabled: bool = True
    glossary: dict[str, Any] | None = None
    asr: dict[str, Any] | None = None
    polish: dict[str, Any] | None = None


class FunasrEnsureRequest(BaseModel):
    pull: bool = True
    funasr_env: dict[str, str] | None = None
    recreate: bool = False


class SlidePageRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None
    regen_markdown: bool = True


class SlideSlotsQuery(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    slide_designer: dict[str, Any] | None = None


class SlideRegenerateSlotRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    slot_id: str = Field(min_length=1, max_length=64)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None


class SlideVerifyRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    slide_index: int = Field(ge=1, le=40)
    conversation_id: str | None = None
    user_id: str | None = None
    endpoint: EndpointPayload | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    slide_designer: dict[str, Any] | None = None
    auto_fix: bool = True


class TemplateScopePayload(BaseModel):
    user_id: int = Field(ge=0)
    tenant_id: int | None = None
    is_platform_operator: bool = False


class TemplateAnalyzeRequest(BaseModel):
    pptx_path: str = Field(min_length=1, description="Absolute path to uploaded PPTX on shared volume")
    endpoint: EndpointPayload | None = None
    label: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    persist: bool = True
    generate_preview: bool = True
    write_scope: str = Field(default="personal", pattern="^(global|tenant|personal)$")
    template_scope: TemplateScopePayload | None = None
    slide_designer: dict[str, Any] | None = None
    background: bool = Field(
        default=True,
        description="When true, return job_id immediately and run analyze in the background.",
    )


class TemplateWorkflowRequest(BaseModel):
    template_id: str = Field(min_length=1, max_length=64)
    endpoint: EndpointPayload | None = None
    slide_index: int | None = Field(default=None, ge=1, le=20)
    auto_fix: bool = True
    template_scope: TemplateScopePayload | None = None


class TemplateListRequest(BaseModel):
    published_only: bool = False
    scope_filter: str | None = Field(default=None, pattern="^(global|tenant|personal)$")
    template_scope: TemplateScopePayload | None = None


def _template_scope_ctx(body: TemplateScopePayload | None) -> "TemplateScopeContext":
    from oaao_orchestrator.slide_project.template_scope import TemplateScopeContext  # noqa: PLC0415

    return TemplateScopeContext.from_payload(body.model_dump() if body is not None else None)


registry = StreamSessionRegistry()
_stream_tokens: dict[str, str] = {}


def _shared_secret() -> str:
    return os.environ.get("OAAO_ORCH_SHARED_SECRET", "oaao_dev_shared_secret")


def _php_vault_api_base() -> str:
    return os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL", "http://web/vault/api").strip().rstrip("/")


async def _report_usage_to_php(*, tenant_id: int | None, event_kind: str, meta: dict[str, Any]) -> None:
    from oaao_orchestrator.php_boundary import assert_php_http_allowed  # noqa: PLC0415

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

def _resolve_api_key(ep: EndpointPayload | None) -> str | None:
    """Bearer token from sidecar env."""
    if ep is None:
        fb = os.environ.get("OPENAI_API_KEY")
        return fb.strip() if isinstance(fb, str) and fb.strip() else None
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


def _resolve_api_key_env_dict(snap: dict[str, Any] | None) -> str | None:
    """Bearer token from sidecar env using orchestrator purpose snapshot."""
    if not isinstance(snap, dict):
        return None
    name = str(snap.get("api_key_env") or "").strip() or "OPENAI_API_KEY"
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
    from oaao_orchestrator.run_executor import execute_chat_run  # noqa: PLC0415

    await execute_chat_run(run_id=run_id, req=req, registry=registry)


@app.get("/health")
async def health() -> dict[str, bool | str]:
    return {"ok": True, "service": "oaao_orchestrator"}


@app.post("/v1/admin/evolution/daily_report")
async def evolution_daily_report(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.daily_report import run_daily_report  # noqa: PLC0415
    from oaao_orchestrator.evaluation.evolution_collections import ensure_evolution_collections  # noqa: PLC0415

    await ensure_evolution_collections()
    return await run_daily_report()


@app.get("/v1/admin/evolution/reports")
async def evolution_reports_list(
    limit: int = Query(default=10, ge=1, le=50),
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_reports  # noqa: PLC0415

    return {"reports": list_evolution_reports(limit=limit)}


class ToolServersEnrichRequest(BaseModel):
    servers: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/v1/admin/tools/enrich_openapi")
async def tools_enrich_openapi(
    body: ToolServersEnrichRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.tools.openapi_fetch import enrich_servers_with_openapi  # noqa: PLC0415

    return {"servers": enrich_servers_with_openapi(body.servers)}


@app.get("/v1/admin/evolution/patches")
async def evolution_patches_list(
    limit: int = Query(default=20, ge=1, le=100),
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_patches  # noqa: PLC0415

    return {"patches": list_evolution_patches(limit=limit)}


@app.get("/v1/admin/evolution/metrics/iqs_actions")
async def evolution_iqs_action_metrics(
    limit: int = Query(default=500, ge=1, le=5000),
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.evolution_store import iqs_action_distribution  # noqa: PLC0415

    dist = iqs_action_distribution(limit=limit)
    return {"distribution": dist, "total": sum(dist.values())}


@app.post("/v1/admin/evolution/patches/{patch_id}/approve")
async def evolution_patch_approve(
    patch_id: str,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.evolution_store import get_evolution_patch, update_evolution_patch  # noqa: PLC0415

    row = get_evolution_patch(patch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="patch_not_found")
    updated = update_evolution_patch(
        patch_id,
        status="applied",
        approved_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"patch": updated}


@app.post("/v1/admin/evolution/rollback/{patch_id}")
async def evolution_patch_rollback(
    patch_id: str,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.evolution_store import get_evolution_patch, update_evolution_patch  # noqa: PLC0415

    row = get_evolution_patch(patch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="patch_not_found")
    updated = update_evolution_patch(
        patch_id,
        status="rolled_back",
        rolled_back_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"patch": updated, "note": "Status recorded — live prompt store rollback is manual until PHP wiring lands."}


@app.get("/v1/admin/crystallization/stats")
async def crystallization_stats_endpoint(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.crystallization.bootstrap import crystallization_stats  # noqa: PLC0415

    return crystallization_stats()


@app.post("/v1/admin/evolution/weekly_apply")
async def evolution_weekly_apply(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.daily_report import run_weekly_auto_apply  # noqa: PLC0415

    return await run_weekly_auto_apply()


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


class AgentAskRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=128)
    decision: str = Field(description="proceed | skip | proceed_fork")


@app.post("/v1/runs/{run_id}/agent_ask")
async def resolve_agent_ask(
    run_id: str,
    body: AgentAskRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    decision = (body.decision or "").strip().lower()
    if decision not in ("proceed", "skip", "proceed_fork"):
        raise HTTPException(status_code=400, detail="decision must be proceed, skip, or proceed_fork")

    resolved = ASK_DECISION_SKIP if decision == "proceed_fork" else decision
    if not run.resolve_agent_ask(body.task_id.strip(), resolved):
        raise HTTPException(
            status_code=404,
            detail="no_pending_ask",
        )

    return {"ok": True, "decision": decision}


@app.post("/v1/skills/discover")
async def skills_discover(
    body: SkillsDiscoverRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    """LLM: match user turn to catalog skills or suggest a new conversation skill (markdown preview)."""
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.micro_skills import catalog_from_request, discover_skills_llm  # noqa: PLC0415

    class _CatReq:
        skills_catalog = body.skills_catalog

    catalog = catalog_from_request(_CatReq())
    api_key = _resolve_api_key(body.endpoint)
    base = (body.endpoint.base_url or "").rstrip("/")
    result = await discover_skills_llm(
        url=f"{base}/chat/completions" if base else "",
        api_key=api_key,
        model=body.endpoint.model,
        user_message=body.user_message,
        catalog=catalog,
        conversation_excerpt=body.conversation_excerpt,
    )
    return {"ok": True, **result}

    return {"ok": True, "run_id": run_id, "task_id": body.task_id, "decision": decision}


@app.post("/v1/slides/slide_slots")
async def slide_slots(
    body: SlideSlotsQuery,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.regenerate import get_slide_slots  # noqa: PLC0415

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return get_slide_slots(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            storage_root=storage_root,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_slots_failed project_id=%s page=%s", body.project_id, body.slide_index)
        raise HTTPException(status_code=500, detail="slide_slots_failed") from exc


@app.post("/v1/slides/regenerate_slot")
async def slide_regenerate_slot(
    body: SlideRegenerateSlotRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.regenerate import regenerate_slide_slot  # noqa: PLC0415

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return await regenerate_slide_slot(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            slot_id=body.slot_id.strip(),
            conversation_id=body.conversation_id,
            user_id=body.user_id,
            endpoint=body.endpoint.model_dump(),
            messages=list(body.messages or []),
            storage_root=storage_root,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "slide_regenerate_slot_failed project_id=%s page=%s slot=%s",
            body.project_id,
            body.slide_index,
            body.slot_id,
        )
        raise HTTPException(status_code=500, detail="slide_regenerate_slot_failed") from exc


@app.post("/v1/slides/regenerate_page")
async def slide_regenerate_page(
    body: SlidePageRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.regenerate import regenerate_slide_page  # noqa: PLC0415

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    try:
        return await regenerate_slide_page(
            project_id=body.project_id.strip(),
            slide_index=body.slide_index,
            conversation_id=body.conversation_id,
            user_id=body.user_id,
            endpoint=body.endpoint.model_dump(),
            messages=list(body.messages or []),
            storage_root=storage_root,
            regen_markdown=bool(body.regen_markdown),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_regenerate_failed project_id=%s page=%s", body.project_id, body.slide_index)
        raise HTTPException(status_code=500, detail="slide_regenerate_failed") from exc


@app.post("/v1/slides/verify_page")
async def slide_verify_page(
    body: SlideVerifyRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.regenerate import (  # noqa: PLC0415
        verify_and_fix_slide_page,
        verify_slide_page_html,
    )

    sd = body.slide_designer if isinstance(body.slide_designer, dict) else {}
    storage_root = sd.get("storage_root") if isinstance(sd.get("storage_root"), str) else None
    if body.auto_fix and body.endpoint is not None:
        try:
            return await verify_and_fix_slide_page(
                project_id=body.project_id.strip(),
                slide_index=body.slide_index,
                conversation_id=body.conversation_id,
                user_id=body.user_id,
                endpoint=body.endpoint.model_dump(),
                messages=list(body.messages or []),
                storage_root=storage_root,
                auto_fix=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "slide_verify_fix_failed project_id=%s page=%s",
                body.project_id,
                body.slide_index,
            )
            raise HTTPException(status_code=500, detail="slide_verify_fix_failed") from exc
    return await verify_slide_page_html(
        project_id=body.project_id.strip(),
        slide_index=body.slide_index,
        storage_root=storage_root,
    )


@app.post("/v1/slides/templates/list")
async def slide_templates_list(
    body: TemplateListRequest | None = None,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.custom_templates import list_custom_templates  # noqa: PLC0415
    from oaao_orchestrator.slide_project.template_registry import (  # noqa: PLC0415
        catalog_version,
        layout_ids,
        themes_data,
    )
    from oaao_orchestrator.slide_project.template_scope import normalize_scope  # noqa: PLC0415

    themes = themes_data().get("themes")
    builtin_themes = sorted(themes.keys()) if isinstance(themes, dict) else []
    published_only = bool(body.published_only) if body is not None else False
    ctx = _template_scope_ctx(body.template_scope if body is not None else None)
    scope_filter = None
    if body is not None and body.scope_filter:
        scope_filter = normalize_scope(body.scope_filter)

    from oaao_orchestrator.slide_project.pptx_render import pptx_render_available  # noqa: PLC0415

    return {
        "catalog_version": catalog_version(),
        "builtin_themes": builtin_themes,
        "builtin_layouts": sorted(layout_ids()),
        "pptx_render_available": pptx_render_available(),
        "custom_templates": list_custom_templates(
            ctx,
            published_only=published_only,
            scope_filter=scope_filter,
        ),
        "scope_capabilities": {
            "can_write_global": False,
            "can_write_tenant": bool(
                ctx.is_tenant_admin and ctx.tenant_id is not None and ctx.tenant_id > 0
            ),
            "can_write_personal": ctx.user_id > 0,
        },
    }


async def _execute_template_analyze(body: TemplateAnalyzeRequest) -> dict[str, Any]:
    from oaao_orchestrator.slide_project.template_analyzer import analyze_pptx_template  # noqa: PLC0415

    from oaao_orchestrator.slide_project.template_scope import can_write_scope, normalize_scope  # noqa: PLC0415

    path = Path(body.pptx_path.strip())
    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    write_scope = normalize_scope(body.write_scope)
    if not can_write_scope(ctx, write_scope):
        raise PermissionError(f"cannot_write_scope:{write_scope}")

    result = await analyze_pptx_template(
        pptx_path=path,
        url=ep.base_url.strip() if ep and ep.base_url else None,
        api_key=_resolve_api_key(ep),
        model=ep.model.strip() if ep and ep.model else None,
        label=body.label,
        user_notes=body.notes,
        persist=bool(body.persist),
        ctx=ctx,
        write_scope=write_scope,
    )
    preview_payload: dict[str, Any] | None = None
    if body.generate_preview and isinstance(result.get("template_id"), str):
        tid = str(result["template_id"])
        preview_mode = str(result.get("preview_mode") or "").strip()
        if preview_mode != "pptx_render":
            from oaao_orchestrator.slide_project.pptx_render import pptx_render_available  # noqa: PLC0415
            from oaao_orchestrator.slide_project.template_pptx_preview import (  # noqa: PLC0415
                try_regenerate_pptx_render_preview,
            )

            if pptx_render_available():
                from oaao_orchestrator.slide_project.async_bridge import run_soffice_job  # noqa: PLC0415

                try:
                    render_retry = await run_soffice_job(
                        try_regenerate_pptx_render_preview,
                        tid,
                        ctx,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("template_pptx_render_retry_failed template_id=%s", tid)
                    render_retry = None
                if render_retry:
                    preview_mode = "pptx_render"
                    result["preview_mode"] = "pptx_render"
                    result["thumbnail_source"] = "pptx_render"
                    result["preview_pages"] = render_retry.get("pages") or []
                    result["status"] = "preview"

        if preview_mode == "pptx_render":
            preview_payload = {
                "ok": True,
                "preview_mode": "pptx_render",
                "pages": result.get("preview_pages") or [],
            }
        else:
            from oaao_orchestrator.slide_project.pptx_render import pptx_render_available  # noqa: PLC0415

            tools_ok = pptx_render_available()
            preview_payload = {
                "ok": False,
                "preview_mode": "render_unavailable",
                "pages": [],
                "render_unavailable": not tools_ok,
                "message": (
                    "PPTX slide render is not available in the orchestrator "
                    "(rebuild the orchestrator image with LibreOffice and poppler-utils, then re-import)."
                    if not tools_ok
                    else "PPTX slide render failed; check orchestrator logs. Re-import after fixing."
                ),
            }
    return {"ok": True, "template": result, "preview": preview_payload}


@app.post("/v1/slides/template_analyze")
async def slide_template_analyze(
    body: TemplateAnalyzeRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    """Analyze uploaded PPTX → custom template JSON (theme + deck_style)."""
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    if body.background:
        from oaao_orchestrator.slide_project.template_import_jobs import start_template_import_job  # noqa: PLC0415

        job_id = await start_template_import_job(lambda: _execute_template_analyze(body))
        return {"ok": True, "job_id": job_id, "status": "running"}

    try:
        return await _execute_template_analyze(body)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_analyze_failed path=%s", body.pptx_path)
        raise HTTPException(status_code=500, detail="slide_template_analyze_failed") from exc


@app.get("/v1/slides/template_import_job/{job_id}")
async def slide_template_import_job(
    job_id: str,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_import_jobs import get_template_import_job  # noqa: PLC0415

    job = await get_template_import_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="template_import_job_not_found")
    if job.status == "running":
        return {"ok": True, "job_id": job.job_id, "status": "running"}
    if job.status == "failed":
        return {
            "ok": False,
            "job_id": job.job_id,
            "status": "failed",
            "detail": job.error or "slide_template_analyze_failed",
        }
    return {"ok": True, "job_id": job.job_id, "status": "done", **(job.result or {})}


@app.post("/v1/slides/template_preview")
async def slide_template_preview(
    body: TemplateWorkflowRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_preview import generate_template_preview  # noqa: PLC0415

    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await generate_template_preview(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=ep.base_url.strip() if ep and ep.base_url else None,
            api_key=_resolve_api_key(ep),
            model=ep.model.strip() if ep and ep.model else None,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_preview_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_preview_failed") from exc


@app.post("/v1/slides/template_fix")
async def slide_template_fix(
    body: TemplateWorkflowRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_preview import (  # noqa: PLC0415
        fix_all_template_previews,
        fix_template_preview_slide,
    )

    ep = body.endpoint
    url = ep.base_url.strip() if ep and ep.base_url else None
    key = _resolve_api_key(ep)
    model = ep.model.strip() if ep and ep.model else None
    ctx = _template_scope_ctx(body.template_scope)
    try:
        if body.slide_index is not None:
            return await fix_template_preview_slide(
                template_id=body.template_id.strip(),
                slide_index=int(body.slide_index),
                ctx=ctx,
                url=url,
                api_key=key,
                model=model,
            )
        return await fix_all_template_previews(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=url,
            api_key=key,
            model=model,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_fix_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_fix_failed") from exc


@app.post("/v1/slides/template_publish")
async def slide_template_publish(
    body: TemplateWorkflowRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_preview import publish_template  # noqa: PLC0415

    ep = body.endpoint
    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await publish_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
            url=ep.base_url.strip() if ep and ep.base_url else None,
            api_key=_resolve_api_key(ep),
            model=ep.model.strip() if ep and ep.model else None,
            auto_fix=bool(body.auto_fix),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_publish_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_publish_failed") from exc


@app.post("/v1/slides/template_unpublish")
async def slide_template_unpublish(
    body: TemplateWorkflowRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_preview import unpublish_template  # noqa: PLC0415

    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await unpublish_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_unpublish_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_unpublish_failed") from exc


@app.post("/v1/slides/template_delete")
async def slide_template_delete(
    body: TemplateWorkflowRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.slide_project.template_preview import delete_template  # noqa: PLC0415

    ctx = _template_scope_ctx(body.template_scope)
    try:
        return await delete_template(
            template_id=body.template_id.strip(),
            ctx=ctx,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("slide_template_delete_failed id=%s", body.template_id)
        raise HTTPException(status_code=500, detail="slide_template_delete_failed") from exc


@app.post("/v1/runs/{run_id}/cancel")
async def cancel_chat_run(
    run_id: str,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    run.request_cancel()
    return {"ok": True, "run_id": run_id, "cancelled": True}


@app.post("/v1/asr/transcribe")
async def transcribe_audio(
    req: AsrTranscribeRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    raw_b64 = (req.audio_base64 or "").strip()
    if raw_b64.startswith("data:") and "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]
    if not raw_b64:
        raise HTTPException(status_code=400, detail="audio_base64 required")

    try:
        audio_bytes = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid_base64") from exc

    suffix = ".webm" if "webm" in req.mime_type.lower() else ".wav"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="oaao_chat_asr_")
    os.close(fd)
    try:
        Path(tmp_path).write_bytes(audio_bytes)
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            text, meta = await run_asr_pipeline_on_file(
                client,
                audio_path=tmp_path,
                asr_cfg=req.asr if isinstance(req.asr, dict) else None,
                polish_cfg=req.polish if isinstance(req.polish, dict) else None,
                glossary=req.glossary if isinstance(req.glossary, dict) else None,
                polish_enabled=bool(req.polish_enabled),
            )
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not text:
        raise HTTPException(status_code=502, detail=str(meta.get("error") or "transcription_failed"))

    return {
        "text": text,
        "raw_text": meta.get("raw_text", ""),
        "polished": bool(meta.get("polished")),
    }


@app.post("/v1/funasr/ensure")
async def funasr_ensure(
    req: FunasrEnsureRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    return await ensure_funasr(pull=bool(req.pull), funasr_env=req.funasr_env, recreate=bool(req.recreate))


@app.get("/v1/funasr/status")
async def funasr_status_route(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    return await funasr_status()


class LiveSessionStartRequest(BaseModel):
    cadence: str = "1v1"
    workspace_id: int | None = None
    user_id: int | None = None
    retention_mode: str = "disk_ttl"
    asr: dict[str, Any] | None = None
    glossary: dict[str, Any] | None = None
    vault_retrieval_profiles: list[dict[str, Any]] | None = None
    embedding: dict[str, Any] | None = None
    vault_rag: dict[str, Any] | None = None


class LiveSessionStopRequest(BaseModel):
    session_id: str
    keep_audio: bool = False


def _orchestrator_public_base() -> str:
    raw = os.environ.get("OAAO_ORCHESTRATOR_PUBLIC_BASE", "").strip()
    if raw:
        return raw.rstrip("/")
    port = os.environ.get("OAAO_SIDECAR_PORT", "8103").strip() or "8103"
    return f"http://127.0.0.1:{port}"


@app.post("/v1/live/session_start")
async def live_session_start(
    req: LiveSessionStartRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.live_meeting.hub import session_start_payload  # noqa: PLC0415

    data = session_start_payload(
        cadence=req.cadence,
        retention_mode=req.retention_mode,
        workspace_id=req.workspace_id,
        user_id=req.user_id,
        public_base=_orchestrator_public_base(),
        asr_cfg=req.asr if isinstance(req.asr, dict) else None,
        glossary=req.glossary if isinstance(req.glossary, dict) else None,
        vault_retrieval_profiles=req.vault_retrieval_profiles
        if isinstance(req.vault_retrieval_profiles, list)
        else None,
        embedding=req.embedding if isinstance(req.embedding, dict) else None,
        vault_rag_config=req.vault_rag if isinstance(req.vault_rag, dict) else None,
    )
    return {"ok": True, "data": data}


def _normalize_score_dims(raw: dict[str, Any] | list[Any] | None) -> dict[str, float]:
    """Drop null / non-numeric dim values — PHP JSON may send [] instead of {}."""
    if raw is None or isinstance(raw, list):
        raw = {}
    out: dict[str, float] = {}
    for key, val in raw.items():
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            out[str(key)] = float(val)
        elif isinstance(val, str) and val.strip():
            try:
                out[str(key)] = float(val)
            except ValueError:
                continue
    return out


class TurnScoreRescoreTurn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    assistant_message_id: int = Field(ge=1)
    turn_index: int = Field(ge=1)
    user_message: str = ""
    assistant_content: str = ""
    conversation_history: list[dict[str, Any]] = Field(default_factory=list)
    pipeline_snap: dict[str, Any] | None = None
    stored_version: str = ""
    iqs: float = 0.0
    accs: float = 0.0
    iqs_dims: dict[str, Any] = Field(default_factory=dict)
    accs_dims: dict[str, Any] = Field(default_factory=dict)
    iqs_action: str = ""
    needs_iqs: bool = True
    needs_accs: bool = True

    @field_validator("iqs_dims", "accs_dims", mode="before")
    @classmethod
    def _coerce_dims_mapping(cls, value: Any) -> Any:
        if value is None or value == []:
            return {}
        if isinstance(value, list):
            return {}
        return value


class TurnScoreRescoreRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    conversation_id: int = Field(ge=1)
    turns: list[TurnScoreRescoreTurn] = Field(default_factory=list)
    coach_endpoint: dict[str, Any] | None = None


@app.post("/v1/turn_scores/rescore")
async def turn_scores_rescore(
    body: TurnScoreRescoreRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload  # noqa: PLC0415
    from oaao_orchestrator.evaluation.turn_score_backfill import (  # noqa: PLC0415
        TurnRescoreItem,
        try_schedule_conversation_rescore,
    )

    items: list[TurnRescoreItem] = []
    for raw in body.turns:
        item = TurnRescoreItem(
            assistant_message_id=int(raw.assistant_message_id),
            turn_index=int(raw.turn_index),
            user_message=str(raw.user_message or ""),
            assistant_content=str(raw.assistant_content or ""),
            conversation_history=list(raw.conversation_history or []),
            pipeline_snap=raw.pipeline_snap if isinstance(raw.pipeline_snap, dict) else None,
            stored_version=str(raw.stored_version or ""),
            iqs=float(raw.iqs),
            accs=float(raw.accs),
            iqs_dims=_normalize_score_dims(raw.iqs_dims),
            accs_dims=_normalize_score_dims(raw.accs_dims),
            iqs_action=str(raw.iqs_action or ""),
            needs_iqs=bool(raw.needs_iqs),
            needs_accs=bool(raw.needs_accs),
        )
        if (item.needs_iqs or item.needs_accs) and item.assistant_content.strip():
            items.append(item)

    if not items:
        return {"ok": True, "queued": 0, "scorer_versions": scorer_versions_payload()}

    queued = await try_schedule_conversation_rescore(
        conversation_id=int(body.conversation_id),
        turns=items,
        coach_endpoint=body.coach_endpoint if isinstance(body.coach_endpoint, dict) else None,
    )
    return {
        "ok": True,
        "queued": len(items) if queued else 0,
        "already_running": not queued,
        "scorer_versions": scorer_versions_payload(),
    }


@app.get("/v1/turn_scores/versions")
async def turn_scores_versions(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload  # noqa: PLC0415

    return {"ok": True, "scorer_versions": scorer_versions_payload()}


@app.get("/v1/work_queues/status")
async def work_queues_status(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.work_queue_status import work_queues_status_payload  # noqa: PLC0415

    return {"ok": True, **work_queues_status_payload()}


@app.post("/v1/live/session_stop")
async def live_session_stop(
    req: LiveSessionStopRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(x_oaao_internal_token, _shared_secret()):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.live_meeting.hub import stop_session  # noqa: PLC0415

    sid = (req.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id required")
    if not await stop_session(sid, keep_audio=bool(req.keep_audio)):
        raise HTTPException(status_code=404, detail="unknown_session")
    return {"ok": True, "session_id": sid, "keep_audio": bool(req.keep_audio)}


@app.websocket("/v1/live/{session_id}/audio")
async def live_audio_websocket(websocket: WebSocket, session_id: str) -> None:
    from oaao_orchestrator.live_meeting.hub import handle_audio_websocket  # noqa: PLC0415

    await handle_audio_websocket(websocket, session_id)


@app.get("/v1/live/{session_id}/stream")
async def live_session_stream(
    session_id: str,
    token: str = Query(""),
    since_seq: int = Query(0, ge=0),
) -> StreamingResponse:
    """SSE tail for live meeting — ``live_transcript`` and system frames."""
    from oaao_orchestrator.live_meeting.hub import get_session, subscribe_live_stream  # noqa: PLC0415
    from oaao_orchestrator.live_meeting.sse_hub import get_live_stream  # noqa: PLC0415
    from oaao_orchestrator.streaming.events import StreamEnvelope  # noqa: PLC0415
    from oaao_orchestrator.streaming.sse import encode_sse  # noqa: PLC0415

    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown_session")
    _ = token

    hub = get_live_stream(session_id)
    if not hub.snapshot_since(since_seq):
        await hub.append(
            StreamEnvelope(phase="system", kind="status", text="live_meeting_ready")
        )

    async def gen():
        async for chunk in subscribe_live_stream(session_id, since_seq=since_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
