"""Background poll for queued Article Research refetch (one item at a time)."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.research.worker import (
    _known_hashes_from_items,
    _post_json,
    execute_claimed_fetch_job,
)

logger = logging.getLogger(__name__)

_idle_log_ticks = 0


def _research_api_base() -> str:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return ""
    return base.replace("/vault/api", "") + "/research/api"


def _worker_urls() -> dict[str, str]:
    api = _research_api_base()
    vault_base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    return {
        "vault_upload_url": vault_base + "/document_upload_text",
        "research_item_url": api + "/item_upsert",
        "refetch_item_claim_url": api + "/refetch_item_claim",
        "refetch_item_finish_url": api + "/refetch_item_finish",
        "refetch_orphans_reset_url": api + "/refetch_orphans_reset",
        "item_refetch_purge_url": api + "/item_refetch_purge",
        "match_notify_url": api + "/match_notify",
    }


async def _finish_refetch_item(
    client: httpx.AsyncClient,
    finish_url: str,
    *,
    item_id: int,
    status: str,
    error_text: str | None = None,
) -> None:
    finish_status = "done" if status in ("done", "skipped") else "failed"
    payload: dict[str, Any] = {"item_id": item_id, "status": finish_status}
    if error_text:
        payload["error_text"] = error_text
    await _post_json(client, finish_url, payload)


def _refetch_counts(resp: dict[str, Any] | None) -> tuple[int, int]:
    if not resp or not isinstance(resp.get("refetch"), dict):
        return 0, 0
    refetch = resp["refetch"]
    return int(refetch.get("queued") or 0), int(refetch.get("running") or 0)


async def _reset_orphan_refetch(
    client: httpx.AsyncClient, reset_url: str, *, max_age_sec: int = 0
) -> bool:
    if not reset_url:
        return False
    resp = await _post_json(client, reset_url, {"max_age_sec": max_age_sec})
    if not resp or not resp.get("success"):
        return False
    reset_n = int(resp.get("reset") or 0)
    if reset_n > 0:
        queued, running = _refetch_counts(resp)
        logger.info(
            "research_refetch_poll: reset %s orphan running row(s) — refetch queued=%s running=%s",
            reset_n,
            queued,
            running,
        )
    return True


async def _ensure_orphan_refetch_reset(client: httpx.AsyncClient, reset_url: str) -> None:
    if not reset_url:
        return
    for attempt in range(15):
        if await _reset_orphan_refetch(client, reset_url, max_age_sec=0):
            return
        if attempt < 14:
            await asyncio.sleep(2)
    logger.warning("research_refetch_poll: orphan reset unavailable after retries")


async def _poll_one_refetch(client: httpx.AsyncClient, urls: dict[str, str]) -> bool:
    """Claim and process one queued refetch item. Returns True if work was attempted."""
    global _idle_log_ticks

    claim_url = urls.get("refetch_item_claim_url") or ""
    finish_url = urls.get("refetch_item_finish_url") or ""
    purge_url = urls.get("item_refetch_purge_url") or ""
    item_id = 0

    try:
        resp = await _post_json(client, claim_url, {})
        item = resp.get("item") if isinstance(resp, dict) else None
        if not isinstance(item, dict):
            queued, running = _refetch_counts(resp if isinstance(resp, dict) else None)
            if queued > 0 or running > 0:
                _idle_log_ticks += 1
                if running > 0 and queued > 0 and _idle_log_ticks in (2, 4, 8):
                    reset_url = urls.get("refetch_orphans_reset_url") or ""
                    await _reset_orphan_refetch(client, reset_url, max_age_sec=90)
                if _idle_log_ticks == 1 or _idle_log_ticks % 12 == 0:
                    logger.info(
                        "research_refetch_poll: idle — queued=%s running=%s (running blocks new claims)",
                        queued,
                        running,
                    )
            else:
                _idle_log_ticks = 0
            return False

        _idle_log_ticks = 0
        item_id = int(item.get("item_id") or 0)
        url = str(item.get("canonical_url") or "").strip()
        vault_id = int(item.get("watch_vault_id") or 0)
        watch_id = int(item.get("watch_id") or 0)
        if item_id < 1 or not url or vault_id < 1 or watch_id < 1:
            if item_id > 0 and finish_url:
                await _finish_refetch_item(
                    client,
                    finish_url,
                    item_id=item_id,
                    status="failed",
                    error_text="invalid_item",
                )
            return False

        logger.info(
            "research_refetch_poll: start item_id=%s watch_id=%s %s",
            item_id,
            watch_id,
            url[:120],
        )

        purge_resp = await _post_json(client, purge_url, {"item_id": item_id, "vault_id": vault_id})
        if not purge_resp or not purge_resp.get("success"):
            logger.warning("research_refetch_poll: purge failed item_id=%s", item_id)
            if finish_url:
                await _finish_refetch_item(
                    client,
                    finish_url,
                    item_id=item_id,
                    status="failed",
                    error_text="purge_failed",
                )
            return True

        llm_cfg = resp.get("summary_llm") if isinstance(resp.get("summary_llm"), dict) else None
        match_llm_cfg = (
            resp.get("match_llm") if isinstance(resp.get("match_llm"), dict) else llm_cfg
        )
        watch_config = (
            resp.get("watch_config") if isinstance(resp.get("watch_config"), dict) else {}
        )
        known_hashes = _known_hashes_from_items(resp.get("known_items"))

        job = {
            **item,
            "canonical_url": url,
            "title": str(item.get("title") or "").strip(),
            "watch_id": watch_id,
            "watch_vault_id": vault_id,
            "watch_container_id": item.get("watch_container_id"),
            "watch_workspace_id": item.get("watch_workspace_id"),
            "watch_owner_user_id": item.get("watch_owner_user_id"),
            "watch_summary_language": item.get("watch_summary_language"),
            "watch_config_json": watch_config if watch_config else item.get("watch_config_json"),
            "force_refetch": True,
            "run_id": 0,
        }

        job_timeout = float(os.environ.get("OAAO_RESEARCH_REFETCH_JOB_TIMEOUT_SEC", "180"))
        try:
            status, err, _meta = await asyncio.wait_for(
                execute_claimed_fetch_job(
                    client,
                    job,
                    upload_url=urls["vault_upload_url"],
                    item_url=urls["research_item_url"],
                    match_notify_url=urls.get("match_notify_url") or "",
                    llm_cfg=llm_cfg,
                    match_llm_cfg=match_llm_cfg,
                    known_hashes=known_hashes,
                ),
                timeout=job_timeout,
            )
        except TimeoutError:
            status = "failed"
            err = {"error": "refetch_timeout"}
            logger.warning(
                "research_refetch_poll: timeout item_id=%s after %.0fs",
                item_id,
                job_timeout,
            )
        if finish_url:
            await _finish_refetch_item(
                client,
                finish_url,
                item_id=item_id,
                status=status,
                error_text=(err or {}).get("error") if err else None,
            )
        err_text = (err or {}).get("error") if err else None
        logger.info(
            "research_refetch_poll: done item_id=%s status=%s%s",
            item_id,
            status,
            f" err={err_text}" if err_text else "",
        )
        return True
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("research_refetch_poll error: %s", exc)
        if item_id > 0 and finish_url:
            try:
                await _finish_refetch_item(
                    client,
                    finish_url,
                    item_id=item_id,
                    status="failed",
                    error_text=str(exc)[:200],
                )
            except Exception as finish_exc:  # noqa: BLE001
                logger.warning("research_refetch_poll finish failed: %s", finish_exc)
        return False


async def research_refetch_poll_loop() -> None:
    urls = _worker_urls()
    claim_url = urls.get("refetch_item_claim_url") or ""
    if not claim_url:
        logger.info("research_refetch_poll: OAAO_VAULT_JOB_POLL_BASE_URL unset — disabled")
        return

    idle_interval = float(os.environ.get("OAAO_RESEARCH_REFETCH_POLL_INTERVAL_SEC", "5"))
    logger.info(
        "research_refetch_poll: enabled (%s) idle_interval=%.1fs (single worker)",
        claim_url,
        idle_interval,
    )

    async with httpx.AsyncClient() as client:
        await _ensure_orphan_refetch_reset(client, urls.get("refetch_orphans_reset_url") or "")
        while True:
            worked = await _poll_one_refetch(client, urls)
            if not worked:
                await asyncio.sleep(idle_interval)
