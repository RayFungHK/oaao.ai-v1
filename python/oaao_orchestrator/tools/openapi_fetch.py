"""Fetch OpenAPI specs from registered tool servers."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin

import httpx

logger = logging.getLogger(__name__)


def fetch_openapi_spec_sync(
    *, base_url: str, openapi_url: str = "/openapi.json", timeout_s: float = 15.0
) -> dict[str, Any] | None:
    """GET ``base_url + openapi_url`` and parse JSON OpenAPI document."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return None
    path = (openapi_url or "/openapi.json").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    url = urljoin(f"{base}/", path.lstrip("/"))
    try:
        with httpx.Client(
            timeout=httpx.Timeout(timeout_s, connect=5.0), follow_redirects=True
        ) as client:
            resp = client.get(url, headers={"Accept": "application/json"})
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and isinstance(data.get("paths"), dict):
                return data
    except Exception:  # noqa: BLE001
        logger.debug("openapi fetch failed url=%s", url, exc_info=True)
    return None


def enrich_servers_with_openapi(servers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return server rows with ``openapi_spec`` filled when fetch succeeds."""
    out: list[dict[str, Any]] = []
    for row in servers:
        if not isinstance(row, dict):
            continue
        entry = dict(row)
        if isinstance(entry.get("openapi_spec"), dict) and entry["openapi_spec"].get("paths"):
            out.append(entry)
            continue
        base = str(entry.get("base_url") or "").strip()
        if not base:
            out.append(entry)
            continue
        spec = fetch_openapi_spec_sync(
            base_url=base,
            openapi_url=str(entry.get("openapi_url") or "/openapi.json"),
        )
        if spec:
            entry["openapi_spec"] = spec
        out.append(entry)
    return out
