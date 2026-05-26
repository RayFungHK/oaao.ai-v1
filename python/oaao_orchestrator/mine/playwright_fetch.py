"""Optional Playwright fetch for JS-rendered pages."""

from __future__ import annotations

import logging

from oaao_orchestrator.mine.fetch import assert_url_allowed

logger = logging.getLogger(__name__)


async def fetch_html_playwright(url: str, *, wait_ms: int = 1500) -> str:
    assert_url_allowed(url)
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("playwright_not_installed") from exc

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            if wait_ms > 0:
                await page.wait_for_timeout(min(wait_ms, 10000))
            return await page.content()
        finally:
            await browser.close()
