"""Evolution metrics persistence — Arango when configured, in-memory fallback."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

_MEMORY_RUNS: list[dict[str, Any]] = []
_MEMORY_LOW_SCORE: list[dict[str, Any]] = []
_MEMORY_PATCHES: list[dict[str, Any]] = []


async def _arango_cfg() -> dict[str, Any] | None:
    from oaao_orchestrator.vault_arango import resolve_arango_from_profile  # noqa: PLC0415

    return resolve_arango_from_profile({})


async def _arango_post(collection: str, doc: dict[str, Any]) -> None:
    from oaao_orchestrator.vault_arango import _arango_request  # noqa: PLC0415

    cfg = await _arango_cfg()
    if not cfg:
        return
    body = dict(doc)
    key = str(body.pop("_key", "") or body.get("run_id") or body.get("patch_id") or "")
    if key:
        body["_key"] = key[:254]
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        await _arango_request(
            client,
            cfg=cfg,
            method="POST",
            path=f"/_api/document/{collection}",
            json_body=body,
        )


async def record_evolution_run(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(timezone.utc).isoformat()}
    _MEMORY_RUNS.append(doc)
    if len(_MEMORY_RUNS) > 5000:
        del _MEMORY_RUNS[:1000]
    try:
        await _arango_post("evolution_runs", doc)
    except Exception:
        logger.debug("evolution_runs arango write skipped", exc_info=True)


async def record_low_score_case(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(timezone.utc).isoformat()}
    _MEMORY_LOW_SCORE.append(doc)
    if len(_MEMORY_LOW_SCORE) > 2000:
        del _MEMORY_LOW_SCORE[:500]
    try:
        await _arango_post("low_score_cases", doc)
    except Exception:
        logger.debug("low_score_cases arango write skipped", exc_info=True)


async def record_evolution_patch(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(timezone.utc).isoformat()}
    _MEMORY_PATCHES.append(doc)
    try:
        await _arango_post("evolution_patches", doc)
    except Exception:
        logger.debug("evolution_patches arango write skipped", exc_info=True)


def list_low_score_cases(*, limit: int = 50) -> list[dict[str, Any]]:
    return list(_MEMORY_LOW_SCORE[-limit:])
