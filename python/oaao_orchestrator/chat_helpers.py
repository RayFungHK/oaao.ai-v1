"""W5-S1 phase 8 — shared chat-pipeline helpers.

Extracted from ``app.py`` so ``routes/chat.py`` and ``run_executor.py`` can
share them without re-importing from ``app.py``. Public names keep their
leading underscore to preserve back-compat for callers that still spell
``from oaao_orchestrator.app import _xxx`` via the re-export shims.

Helpers:
- URL building: ``_hostport_looks_http_default``, ``_ensure_url_scheme``,
  ``_chat_completions_url``.
- SSE-safe text: ``_sanitize_client_text`` (strips upstream URLs).
- Planner endpoint resolution: ``_resolve_planner_llm``.
- Pipeline hook slot: ``_hook_before_llm``.
- PHP usage callback: ``_shared_secret``, ``_php_vault_api_base``,
  ``_report_usage_to_php``.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

from oaao_orchestrator.endpoint_keys import resolve_api_key, resolve_api_key_env_dict

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL building
# ---------------------------------------------------------------------------


def _hostport_looks_http_default(hostport: str) -> bool:
    """Bare URLs without a scheme: use http for loopback / LAN-style hosts, https for hostnames."""
    h = hostport.strip().lower()
    if "@" in h:
        h = h.split("@")[-1]
    host = h.split(":", 1)[0].strip("[]")
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"):
        return True
    if host.endswith(".local"):
        return True
    return bool(re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", host))


def _ensure_url_scheme(base_url: str) -> str:
    """httpx requires an explicit scheme; admins often paste ``host.name/v1`` only."""
    bu = base_url.strip()
    if not bu:
        return bu
    low = bu.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return bu
    hostport = bu.split("/", 1)[0]
    prefix = "http://" if _hostport_looks_http_default(hostport) else "https://"
    return f"{prefix}{bu}"


def _chat_completions_url(base_url: str) -> str:
    bu = _ensure_url_scheme(base_url).rstrip("/")
    if bu.endswith("/v1"):
        return f"{bu}/chat/completions"
    return f"{bu}/v1/chat/completions"


# ---------------------------------------------------------------------------
# SSE-safe text
# ---------------------------------------------------------------------------


_CLIENT_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)


def _sanitize_client_text(text: str, *, max_len: int = 480) -> str:
    """Remove http(s) URLs from strings shipped over SSE — keep full text in server logs only."""
    s = text.strip()
    if not s:
        return s
    s = _CLIENT_URL_RE.sub("[endpoint]", s)
    if len(s) > max_len:
        return s[: max_len - 1] + "…"
    return s


# ---------------------------------------------------------------------------
# Planner endpoint resolution
# ---------------------------------------------------------------------------


def _resolve_planner_llm(req: Any) -> tuple[str, str | None, str]:
    """Task planner URL/key/model — planning.* purpose when configured, else chat endpoint."""
    planner = getattr(req, "planner", None)
    if isinstance(planner, dict):
        base = str(planner.get("base_url") or "").strip()
        model = str(planner.get("model") or "").strip()
        if base and model:
            return _chat_completions_url(base), resolve_api_key_env_dict(planner), model
    ep = req.endpoint
    return _chat_completions_url(ep.base_url), resolve_api_key(ep), str(ep.model or "")


# ---------------------------------------------------------------------------
# Pipeline hook
# ---------------------------------------------------------------------------


def _hook_before_llm(req: Any) -> None:
    """Legacy Sidecar-style pipeline hook slot (baseline: no-op)."""
    _ = req


# ---------------------------------------------------------------------------
# PHP usage callback
# ---------------------------------------------------------------------------


def _shared_secret() -> str:
    from oaao_orchestrator._internal_secret import require_internal_secret

    return require_internal_secret()


def _php_vault_api_base() -> str:
    return (
        os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL", "http://web/vault/api").strip().rstrip("/")
    )


async def _report_usage_to_php(
    *, tenant_id: int | None, event_kind: str, meta: dict[str, Any]
) -> None:
    from oaao_orchestrator.php_boundary import assert_php_http_allowed

    if tenant_id is None or tenant_id < 1:
        return
    url = f"{_php_vault_api_base()}/usage_record"
    assert_php_http_allowed(url, context="usage_record")
    body: dict[str, Any] = {
        "tenant_id": tenant_id,
        "event_kind": event_kind,
        "meta": meta,
    }
    if event_kind == "chat.completion":
        pt = meta.get("prompt_tokens")
        ct = meta.get("completion_tokens") or meta.get("tokens_out")
        total = 0.0
        if pt is not None or ct is not None:
            try:
                total = float(int(pt or 0) + int(ct or 0))
            except (TypeError, ValueError):
                total = 0.0
        elif ct is not None:
            try:
                total = float(int(ct))
            except (TypeError, ValueError):
                total = 0.0
        if total > 0:
            body["quantity"] = total
            body["unit"] = "tokens"
    pk = meta.get("purpose_key")
    if isinstance(pk, str) and pk.strip():
        body["purpose_key"] = pk.strip()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-OAAO-Internal-Token": _shared_secret(),
                },
                json=body,
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("usage_record callback failed: %s", exc)
