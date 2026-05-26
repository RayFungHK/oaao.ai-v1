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
import logging
import os
import re
import secrets
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from oaao_orchestrator.asr_common import run_asr_pipeline_on_file
from oaao_orchestrator.cors_config import resolve_cors_config
from oaao_orchestrator.funasr_ops import ensure_funasr, funasr_status
from oaao_orchestrator.log_config import configure_oaao_logging
from oaao_orchestrator.research_fetch_poll import research_fetch_poll_loop
from oaao_orchestrator.research_refetch_poll import research_refetch_poll_loop
from oaao_orchestrator.routes.admin import router as _admin_router
from oaao_orchestrator.routes.health import router as _health_router
from oaao_orchestrator.routes.live import router as _live_router
from oaao_orchestrator.routes.mine import router as _mine_router
from oaao_orchestrator.routes.research import router as _research_router
from oaao_orchestrator.routes.runs import router as _runs_router
from oaao_orchestrator.routes.slides import router as _slides_router
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
    from oaao_orchestrator.run_executor import execute_chat_run

    await execute_chat_run(run_id=run_id, req=req, registry=registry)


# W5-S1 — health + admin routes extracted to oaao_orchestrator.routes.* and
# mounted here. The duplicated X-OAAO-Internal-Token guard now lives in
# routes._deps.require_internal_token. The historical blocks that occupied
# lines 555-718 of this file were moved verbatim; behaviour is preserved.
app.include_router(_health_router)
app.include_router(_admin_router)
app.include_router(_mine_router)
app.include_router(_research_router)
app.include_router(_live_router)
app.include_router(_runs_router)
app.include_router(_slides_router)


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


@app.post("/v1/skills/discover")
async def skills_discover(
    body: SkillsDiscoverRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    """LLM: match user turn to catalog skills or suggest a new conversation skill (markdown preview)."""
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.micro_skills import (
        catalog_from_request,
        discover_skills_llm,
    )

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



@app.post("/v1/asr/transcribe")
async def transcribe_audio(
    req: AsrTranscribeRequest,
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    raw_b64 = (req.audio_base64 or "").strip()
    if raw_b64.startswith("data:") and "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]
    if not raw_b64:
        raise HTTPException(status_code=400, detail="audio_base64 required")

    try:
        audio_bytes = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
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
        raise HTTPException(
            status_code=502, detail=str(meta.get("error") or "transcription_failed")
        )

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
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    return await ensure_funasr(
        pull=bool(req.pull), funasr_env=req.funasr_env, recreate=bool(req.recreate)
    )


@app.get("/v1/funasr/status")
async def funasr_status_route(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    return await funasr_status()


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
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")

    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload
    from oaao_orchestrator.evaluation.turn_score_backfill import (
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
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload

    return {"ok": True, "scorer_versions": scorer_versions_payload()}


@app.get("/v1/work_queues/status")
async def work_queues_status(
    x_oaao_internal_token: str | None = Header(default=None, alias="X-OAAO-Internal-Token"),
) -> dict[str, Any]:
    if not x_oaao_internal_token or not secrets.compare_digest(
        x_oaao_internal_token, _shared_secret()
    ):
        raise HTTPException(status_code=403, detail="bad_internal_token")
    from oaao_orchestrator.evaluation.work_queue_status import (
        work_queues_status_payload,
    )

    return {"ok": True, **work_queues_status_payload()}
