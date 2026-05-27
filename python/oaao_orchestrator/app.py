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
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from oaao_orchestrator.cors_config import resolve_cors_config
from oaao_orchestrator.log_config import configure_oaao_logging
from oaao_orchestrator.research_cron_poll import research_cron_poll_loop
from oaao_orchestrator.research_fetch_poll import research_fetch_poll_loop
from oaao_orchestrator.research_refetch_poll import research_refetch_poll_loop
from oaao_orchestrator.routes.admin import router as _admin_router
from oaao_orchestrator.routes.asr import router as _asr_router
from oaao_orchestrator.routes.chat import router as _chat_router
from oaao_orchestrator.routes.health import router as _health_router
from oaao_orchestrator.routes.live import router as _live_router
from oaao_orchestrator.routes.mine import router as _mine_router
from oaao_orchestrator.routes.research import router as _research_router
from oaao_orchestrator.routes.runs import router as _runs_router
from oaao_orchestrator.routes.skills import router as _skills_router
from oaao_orchestrator.routes.slides import router as _slides_router
from oaao_orchestrator.routes.turn_scores import router as _turn_scores_router
from oaao_orchestrator.routes.version import router as _version_router
from oaao_orchestrator.routes.media import router as _media_router
from oaao_orchestrator.routes.contracts import router as _contracts_router
from oaao_orchestrator.build_info import load_build_info
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
    research_cron_task = asyncio.create_task(research_cron_poll_loop())
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
    research_cron_task.cancel()
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
    try:
        await research_cron_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="oaao orchestrator sidecar",
    version=str(load_build_info().get("version") or "0.0.0"),
    lifespan=_lifespan,
)

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
# W5-S1 phase 8 — chat models + helpers moved to dedicated modules; re-exported
# here so historic `from oaao_orchestrator.app import ChatRunRequest, _xxx`
# imports keep working (e.g. tests, ad-hoc shell sessions).
from oaao_orchestrator.chat_helpers import (  # noqa: E402, F401
    _chat_completions_url,
    _hook_before_llm,
    _php_vault_api_base,
    _report_usage_to_php,
    _resolve_planner_llm,
    _sanitize_client_text,
    _shared_secret,
)
from oaao_orchestrator.chat_models import (  # noqa: E402, F401
    ChatProfilePayload,
    ChatRunRequest,
    VaultSourceRef,
)
from oaao_orchestrator.endpoint_keys import (  # noqa: E402, F401
    resolve_api_key as _resolve_api_key,
)
from oaao_orchestrator.endpoint_keys import (  # noqa: E402, F401
    resolve_api_key_env_dict as _resolve_api_key_env_dict,
)
from oaao_orchestrator.routes._shared_models import EndpointPayload  # noqa: E402, F401

# Streaming state moved to streaming_state.py so routes/runs.py can share it
# without creating an import cycle with app.py.
from oaao_orchestrator.streaming_state import (  # noqa: E402, F401
    registry,
    stream_tokens,
    _stream_tokens,
)

# W5-S1 — health + admin routes extracted to oaao_orchestrator.routes.* and
# mounted here. The duplicated X-OAAO-Internal-Token guard now lives in
# routes._deps.require_internal_token. The historical blocks that occupied
# lines 555-718 of this file were moved verbatim; behaviour is preserved.
app.include_router(_health_router)
app.include_router(_version_router)
app.include_router(_admin_router)
app.include_router(_asr_router)
app.include_router(_chat_router)
app.include_router(_mine_router)
app.include_router(_research_router)
app.include_router(_live_router)
app.include_router(_runs_router)
app.include_router(_skills_router)
app.include_router(_slides_router)
app.include_router(_turn_scores_router)
app.include_router(_media_router)
app.include_router(_contracts_router)


