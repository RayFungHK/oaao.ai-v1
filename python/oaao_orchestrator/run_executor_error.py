"""Top-20 #6 phase 13 — run-level error envelope extracted.

The ``except Exception as e:`` arm of :func:`execute_chat_run` used to inline
error classification (``iqs_failed`` vs ``llm_stream_failed``) plus a
``StreamEnvelope`` emit carrying the sanitized detail and the Docker
hostname hint. That tail now lives in :func:`handle_run_error`; the caller
just hands it the run/req/exception and stores the returned detail string.
"""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope

logger = logging.getLogger(__name__)


async def handle_run_error(
    *,
    run: Any,
    req: Any,
    run_id: str,
    exc: BaseException,
) -> str:
    """Emit the run-level error envelope and return the sanitized detail.

    Caller is expected to set ``run_failed = True`` and assign the returned
    string to ``run_error_detail`` so the finalize tail picks it up.
    """
    from oaao_orchestrator.chat_helpers import (
        _chat_completions_url,
        _sanitize_client_text,
    )

    run_error_detail = _sanitize_client_text(str(exc))
    req_url = _chat_completions_url(req.endpoint.base_url)
    err_code = (
        "iqs_failed"
        if "iqs" in type(exc).__name__.lower() or "Breaker" in type(exc).__name__
        else "llm_stream_failed"
    )
    logger.exception(
        "chat_run_failed run_id=%s ref=%s url=%s code=%s",
        run_id,
        req.endpoint.endpoint_ref,
        req_url,
        err_code,
    )
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="error",
            text=err_code,
            payload={
                "detail": run_error_detail,
                "exc_type": type(exc).__name__,
                "hint": "From inside Docker use this compose stack's service hostname + container port for the LLM (e.g. http://my-llm:1234/v1/...); avoid http://127.0.0.1 unless the model shares that container's namespace. Only when the inference server runs on the workstation use http://host.docker.internal:<host-port>.",
            },
        )
    )
    return run_error_detail
