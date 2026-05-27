"""Background poll — POST /research/api/cron_run on interval (Docker-friendly scheduler)."""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)


def _research_api_base() -> str:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return ""
    return base.replace("/vault/api", "") + "/research/api"


def _cron_disabled() -> bool:
    return os.environ.get("OAAO_RESEARCH_CRON_DISABLE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def research_cron_poll_loop() -> None:
    """Wake due Article Research watches by calling PHP cron_run."""
    if _cron_disabled():
        logger.info("research_cron_poll_loop disabled (OAAO_RESEARCH_CRON_DISABLE)")
        return

    api_base = _research_api_base()
    if not api_base:
        logger.info("research_cron_poll_loop skipped — OAAO_VAULT_JOB_POLL_BASE_URL unset")
        return

    secret = (os.environ.get("OAAO_ORCH_SHARED_SECRET") or "").strip()
    if not secret:
        logger.warning("research_cron_poll_loop skipped — OAAO_ORCH_SHARED_SECRET unset")
        return

    interval = max(60, int(os.environ.get("OAAO_RESEARCH_CRON_INTERVAL_SEC", "300") or 300))
    url = f"{api_base.rstrip('/')}/cron_run"
    headers = {
        "X-OAAO-Internal-Token": secret,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(120.0, connect=10.0)

    logger.info("research_cron_poll_loop started interval=%ss url=%s", interval, url)

    async with httpx.AsyncClient(timeout=timeout) as client:
        while True:
            try:
                resp = await client.post(url, headers=headers, json={})
                if resp.status_code >= 400:
                    logger.warning(
                        "research_cron_poll HTTP %s body=%s",
                        resp.status_code,
                        resp.text[:300],
                    )
                else:
                    try:
                        data = resp.json()
                        ran = data.get("ran") if isinstance(data, dict) else None
                        if isinstance(ran, int) and ran > 0:
                            logger.info("research_cron_poll ran=%s", ran)
                    except ValueError:
                        pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("research_cron_poll failed: %s", exc)
            await asyncio.sleep(interval)
