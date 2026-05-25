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
_MEMORY_REPORTS: list[dict[str, Any]] = []


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


async def record_evolution_report(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(timezone.utc).isoformat()}
    _MEMORY_REPORTS.append(doc)
    if len(_MEMORY_REPORTS) > 200:
        del _MEMORY_REPORTS[:50]
    try:
        await _arango_post("evolution_reports", doc)
    except Exception:
        logger.debug("evolution_reports arango write skipped", exc_info=True)


def list_low_score_cases(*, limit: int = 50) -> list[dict[str, Any]]:
    return list(_MEMORY_LOW_SCORE[-limit:])


def list_evolution_reports(*, limit: int = 10) -> list[dict[str, Any]]:
    return list(reversed(_MEMORY_REPORTS[-limit:]))


def list_evolution_runs(*, limit: int = 500) -> list[dict[str, Any]]:
    return list(_MEMORY_RUNS[-limit:])


def list_evolution_patches(*, limit: int = 50) -> list[dict[str, Any]]:
    return list(reversed(_MEMORY_PATCHES[-limit:]))


def get_evolution_patch(patch_id: str) -> dict[str, Any] | None:
    pid = (patch_id or "").strip()
    for row in reversed(_MEMORY_PATCHES):
        if str(row.get("patch_id") or "") == pid:
            return dict(row)
    return None


def update_evolution_patch(patch_id: str, **fields: Any) -> dict[str, Any] | None:
    pid = (patch_id or "").strip()
    for i in range(len(_MEMORY_PATCHES) - 1, -1, -1):
        if str(_MEMORY_PATCHES[i].get("patch_id") or "") == pid:
            _MEMORY_PATCHES[i] = {**_MEMORY_PATCHES[i], **fields}
            return dict(_MEMORY_PATCHES[i])
    return None


def iqs_action_distribution(*, limit: int = 500) -> dict[str, int]:
    """Aggregate iqs_action counts from recent evolution runs."""
    counts: dict[str, int] = {}
    for row in _MEMORY_RUNS[-limit:]:
        action = str(row.get("iqs_action") or "").strip()
        if not action:
            continue
        counts[action] = counts.get(action, 0) + 1
    return counts

