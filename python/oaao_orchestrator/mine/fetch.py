"""HTTP fetch for mine sources with basic SSRF guard."""

from __future__ import annotations

import ipaddress
import logging
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

MAX_BYTES = 2_000_000


def _host_blocked(host: str) -> bool:
    h = (host or "").strip().lower()
    if h in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return True
    if h.endswith(".local") or h.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local)
    except ValueError:
        return False


def assert_url_allowed(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("url_scheme_not_allowed")
    if not parsed.hostname or _host_blocked(parsed.hostname):
        raise ValueError("url_host_not_allowed")


async def fetch_text(client: httpx.AsyncClient, url: str, *, method: str = "GET") -> str:
    assert_url_allowed(url)
    m = (method or "GET").upper()
    r = await client.request(
        m, url, timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True
    )
    if r.status_code >= 400:
        raise RuntimeError(f"http_{r.status_code}")
    content = r.content
    if len(content) > MAX_BYTES:
        content = content[:MAX_BYTES]
    return content.decode("utf-8", errors="replace")


async def fetch_json(client: httpx.AsyncClient, url: str, *, method: str = "GET") -> Any:
    import json

    text = await fetch_text(client, url, method=method)
    return json.loads(text)
