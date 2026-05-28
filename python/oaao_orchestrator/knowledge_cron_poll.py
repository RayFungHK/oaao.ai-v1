"""WS-1-S5/S6 — poll PHP knowledge_cron_run (reads Settings → orchestrator refresh)."""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)


def _endpoints_api_base() -> str:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/vault/api"):
        return base[: -len("/vault/api")] + "/endpoints/api"
    return ""


def _cron_disabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_CRON_DISABLE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def knowledge_cron_poll_loop() -> None:
    """Tick scheduled Knowledge bucket refresh via PHP (tenant Settings-aware)."""
    if _cron_disabled():
        logger.info("knowledge_cron_poll_loop disabled (OAAO_KNOWLEDGE_CRON_DISABLE)")
        return

    api_base = _endpoints_api_base()
    if not api_base:
        logger.info("knowledge_cron_poll_loop skipped — OAAO_VAULT_JOB_POLL_BASE_URL unset")
        return

    secret = (os.environ.get("OAAO_ORCH_SHARED_SECRET") or "").strip()
    if not secret:
        logger.warning("knowledge_cron_poll_loop skipped — OAAO_ORCH_SHARED_SECRET unset")
        return

    interval = max(300, int(os.environ.get("OAAO_KNOWLEDGE_CRON_POLL_INTERVAL_SEC", "3600") or 3600))
    url = f"{api_base.rstrip('/')}/knowledge_cron_run"
    headers = {
        "X-OAAO-Internal-Token": secret,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(360.0, connect=15.0)

    logger.info("knowledge_cron_poll_loop started interval=%ss url=%s", interval, url)

    async with httpx.AsyncClient(timeout=timeout) as client:
        while True:
            try:
                resp = await client.post(url, headers=headers, json={})
                if resp.status_code >= 400:
                    logger.warning(
                        "knowledge_cron_poll HTTP %s body=%s",
                        resp.status_code,
                        resp.text[:400],
                    )
                else:
                    try:
                        data = resp.json()
                        if isinstance(data, dict):
                            if data.get("skipped"):
                                logger.debug(
                                    "knowledge_cron_poll skipped reason=%s",
                                    data.get("reason"),
                                )
                            orch = data.get("orchestrator")
                            if isinstance(orch, dict):
                                refreshed = orch.get("refreshed")
                                if isinstance(refreshed, int) and refreshed > 0:
                                    logger.info(
                                        "knowledge_cron_poll refreshed=%s",
                                        refreshed,
                                    )
                    except ValueError:
                        pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("knowledge_cron_poll failed: %s", exc)
            await asyncio.sleep(interval)
