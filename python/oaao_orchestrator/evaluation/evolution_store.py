"""Evolution metrics persistence — Arango when configured, in-memory fallback."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MEMORY_RUNS: list[dict[str, Any]] = []
_MEMORY_LOW_SCORE: list[dict[str, Any]] = []
_MEMORY_PATCHES: list[dict[str, Any]] = []
_MEMORY_REPORTS: list[dict[str, Any]] = []


async def _arango_cfg() -> dict[str, Any] | None:
    from oaao_orchestrator.vault_arango import resolve_arango_from_profile

    return resolve_arango_from_profile({})


async def _arango_post(collection: str, doc: dict[str, Any]) -> None:
    from oaao_orchestrator.vault_arango import _arango_request

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
    doc = {**row, "recorded_at": datetime.now(UTC).isoformat()}
    _MEMORY_RUNS.append(doc)
    if len(_MEMORY_RUNS) > 5000:
        del _MEMORY_RUNS[:1000]
    try:
        await _arango_post("evolution_runs", doc)
    except Exception:  # noqa: BLE001
        logger.debug("evolution_runs arango write skipped", exc_info=True)


async def record_low_score_case(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(UTC).isoformat()}
    _MEMORY_LOW_SCORE.append(doc)
    if len(_MEMORY_LOW_SCORE) > 2000:
        del _MEMORY_LOW_SCORE[:500]
    try:
        await _arango_post("low_score_cases", doc)
    except Exception:  # noqa: BLE001
        logger.debug("low_score_cases arango write skipped", exc_info=True)


async def record_evolution_patch(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(UTC).isoformat()}
    _MEMORY_PATCHES.append(doc)
    try:
        await _arango_post("evolution_patches", doc)
    except Exception:  # noqa: BLE001
        logger.debug("evolution_patches arango write skipped", exc_info=True)


async def record_evolution_report(row: dict[str, Any]) -> None:
    doc = {**row, "recorded_at": datetime.now(UTC).isoformat()}
    _MEMORY_REPORTS.append(doc)
    if len(_MEMORY_REPORTS) > 200:
        del _MEMORY_REPORTS[:50]
    try:
        await _arango_post("evolution_reports", doc)
    except Exception:  # noqa: BLE001
        logger.debug("evolution_reports arango write skipped", exc_info=True)


def list_low_score_cases(*, limit: int = 50) -> list[dict[str, Any]]:
    return list(_MEMORY_LOW_SCORE[-limit:])


async def _arango_query(collection: str, query: str, *, bind: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    from oaao_orchestrator.vault_arango import _arango_request

    cfg = await _arango_cfg()
    if not cfg:
        return []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            resp = await _arango_request(
                client,
                cfg=cfg,
                method="POST",
                path="/_api/cursor",
                json_body={"query": query, "bindVars": bind or {}},
            )
            if resp is None or resp.status_code != 201:
                return []
            return [r for r in resp.json().get("result") or [] if isinstance(r, dict)]
    except Exception:  # noqa: BLE001
        logger.debug("arango query failed collection=%s", collection, exc_info=True)
        return []


def list_evolution_reports(*, limit: int = 10) -> list[dict[str, Any]]:
    mem = list(reversed(_MEMORY_REPORTS[-limit:]))
    return mem


async def list_evolution_reports_merged(*, limit: int = 10) -> list[dict[str, Any]]:
    """Merge in-memory reports with Arango-backed history."""
    mem = list_evolution_reports(limit=limit)
    arango_rows = await _arango_query(
        "evolution_reports",
        """
            FOR r IN evolution_reports
              SORT r.generated_at DESC
              LIMIT @lim
              RETURN r
        """,
        bind={"lim": limit},
    )
    by_id: dict[str, dict[str, Any]] = {}
    for row in arango_rows:
        rid = str(row.get("report_id") or row.get("_key") or "")
        if rid:
            by_id[rid] = row
    for row in mem:
        rid = str(row.get("report_id") or "")
        if rid:
            by_id[rid] = {**by_id.get(rid, {}), **row}
    merged = sorted(by_id.values(), key=lambda r: str(r.get("generated_at") or ""), reverse=True)
    return merged[:limit]


async def list_evolution_patches_merged(*, limit: int = 50) -> list[dict[str, Any]]:
    mem = list_evolution_patches(limit=limit)
    arango_rows = await _arango_query(
        "evolution_patches",
        """
            FOR p IN evolution_patches
              SORT p.recorded_at DESC
              LIMIT @lim
              RETURN p
        """,
        bind={"lim": limit},
    )
    by_id: dict[str, dict[str, Any]] = {}
    for row in arango_rows:
        pid = str(row.get("patch_id") or row.get("_key") or "")
        if pid:
            by_id[pid] = row
    for row in mem:
        pid = str(row.get("patch_id") or "")
        if pid:
            by_id[pid] = {**by_id.get(pid, {}), **row}
    merged = sorted(by_id.values(), key=lambda r: str(r.get("recorded_at") or ""), reverse=True)
    return merged[:limit]


def update_evolution_report(report_id: str, **fields: Any) -> dict[str, Any] | None:
    rid = (report_id or "").strip()
    for i in range(len(_MEMORY_REPORTS) - 1, -1, -1):
        if str(_MEMORY_REPORTS[i].get("report_id") or "") == rid:
            _MEMORY_REPORTS[i] = {**_MEMORY_REPORTS[i], **fields}
            return dict(_MEMORY_REPORTS[i])
    if fields:
        row = {"report_id": rid, **fields}
        _MEMORY_REPORTS.append(row)
        return row
    return None


async def update_evolution_report_persisted(report_id: str, **fields: Any) -> dict[str, Any] | None:
    updated = update_evolution_report(report_id, **fields)
    if updated is None:
        return None
    try:
        await _arango_post("evolution_reports", {**updated, "_key": report_id[:254]})
    except Exception:  # noqa: BLE001
        logger.debug("evolution_reports arango update skipped", exc_info=True)
    return updated


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
