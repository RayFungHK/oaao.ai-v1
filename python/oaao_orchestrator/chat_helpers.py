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


_CF_HTML_RE = re.compile(r"<!doctype\s+html|<html[\s>]", re.IGNORECASE)
_CF_TITLE_RE = re.compile(r"<title>\s*([^<]+?)\s*</title>", re.IGNORECASE)


def _endpoint_host_label(base_url: str) -> str:
    if not base_url.strip():
        return ""
    try:
        from urllib.parse import urlparse

        return urlparse(_ensure_url_scheme(base_url)).hostname or ""
    except Exception:  # noqa: BLE001
        return ""


def upstream_http_error_payload(
    status: int,
    raw: str,
    *,
    endpoint_base_url: str = "",
    endpoint_ref: str = "",
    endpoint_model: str = "",
) -> dict[str, Any]:
    """SSE-safe upstream HTTP error — never ship Cloudflare HTML pages to the client."""
    host = _endpoint_host_label(endpoint_base_url)
    label = (endpoint_ref or endpoint_model or host or "LLM endpoint").strip()
    low = raw.lower()
    is_cf_html = status >= 500 and (
        _CF_HTML_RE.search(raw[:512]) is not None
        or "cloudflare" in low
        or "bad gateway" in low
        or "error code:" in low
    )
    out: dict[str, Any] = {}
    if host:
        out["endpoint_host"] = host
    if is_cf_html:
        title_m = _CF_TITLE_RE.search(raw)
        title = title_m.group(1).strip() if title_m else f"HTTP {status}"
        host_bit = f" ({host})" if host and host not in label else ""
        out["body"] = (
            f"{title} — Cloudflare cannot reach the inference origin for «{label}»{host_bit}. "
            "Start or repair the vLLM/Ollama service behind that hostname, or change Settings → Endpoints."
        )
        out["hint"] = (
            "This is an upstream/infrastructure fault, not an OAAO application bug. "
            "Verify the GPU server is running and Cloudflare DNS/proxy targets a healthy origin."
        )
        return out
    out["body"] = _sanitize_client_text(raw, max_len=600)
    if status in (502, 503, 504):
        out["hint"] = (
            "Upstream returned an error. Confirm the inference server for this endpoint is running "
            "and reachable from the orchestrator container."
        )
    return out


# ---------------------------------------------------------------------------
# Planner endpoint resolution
# ---------------------------------------------------------------------------


def _resolve_planner_llm(req: Any) -> tuple[str, str | None, str]:
    """Task planner URL/key/model — ``planning.*`` only; never the full-context chat endpoint.

    Planner calls use a compact two-message payload (system + flags), not ``req.messages``
    history. Bind ``planning.primary`` to a small/fast model (e.g. Gemma E4B); bind
    ``chat.primary`` / Fast profile to the large-context model (e.g. 26B).
    """
    log = logging.getLogger(__name__)
    planner = getattr(req, "planner", None)
    if isinstance(planner, dict):
        base = str(planner.get("base_url") or "").strip()
        model = str(planner.get("model") or "").strip()
        if base and model:
            return _chat_completions_url(base), resolve_api_key_env_dict(planner), model
    ep = req.endpoint
    log.warning(
        "planner_missing_planning_purpose — falling back to chat endpoint %s (%s); "
        "assign planning.primary (e.g. E4B) in Settings",
        getattr(ep, "endpoint_ref", ""),
        getattr(ep, "model", ""),
    )
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
