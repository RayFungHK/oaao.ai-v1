"""
PHP ↔ Python service boundary.

**Run bootstrap (chat):** PHP ``send.php`` resolves auth + master data once and POSTs a fat
``ChatRunRequest``. During ``execute_chat_run`` the sidecar must **not** call PHP for MDM
(vault profiles, endpoints, scope, planner catalog). Allowed mid-run PHP HTTP:

- ``vault_job_finish`` — job state machine + document side effects (until fully ported)
- ``usage_record`` / ``assistant_internal_sync`` — fire-and-forget telemetry & adjunct sync
- Explicit env overrides for legacy poll mode

Vault **claim** should use Postgres ``SKIP LOCKED`` when ``OAAO_PG_URL`` is set.
"""

from __future__ import annotations

import logging
import os
from typing import Final
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

ALLOWED_PHP_SUFFIXES: Final[tuple[str, ...]] = (
    "/vault_job_finish",
    "/vault_job_claim",
    "/vault_job_reclaim_orphans",
    "/usage_record",
    "/assistant_internal_sync",
    "/turn_score_upsert",
)

MID_RUN_FORBIDDEN_SUFFIXES: Final[tuple[str, ...]] = (
    "/vault_tree",
    "/document_upload",
    "/chat/api/send",
)


def vault_job_claim_via_postgres() -> bool:
    """When true, claim/reclaim use ``OAAO_PG_URL`` instead of HTTP poll claim."""
    mode = (os.environ.get("OAAO_VAULT_JOB_CLAIM_MODE") or "auto").strip().lower()
    if mode in ("php", "http"):
        return False
    if mode in ("pg", "postgres"):
        return True
    return pg_url() is not None


def pg_url() -> str | None:
    raw = (os.environ.get("OAAO_PG_URL") or "").strip()
    return raw or None


def chat_persist_enabled() -> bool:
    mode = (os.environ.get("OAAO_CHAT_PERSIST_MODE") or "auto").strip().lower()
    if mode in ("0", "false", "no", "off", "php"):
        return False
    if mode in ("1", "true", "yes", "on", "orchestrator", "py"):
        return True
    return sqlite_adjunct_path() is not None


def sqlite_adjunct_path() -> str | None:
    raw = (os.environ.get("OAAO_AUTH_SQLITE_PATH") or "").strip()
    return raw if raw else None


def php_chat_api_base() -> str:
    explicit = (os.environ.get("OAAO_CHAT_INTERNAL_BASE_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    vault_base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "http://web/vault/api").strip().rstrip("/")
    if vault_base.endswith("/vault/api"):
        return vault_base[: -len("/vault/api")] + "/chat/api"
    return "http://web/chat/api"


def php_vault_api_base() -> str:
    return (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "http://web/vault/api").strip().rstrip("/")


def assert_php_http_allowed(url: str, *, context: str) -> None:
    """Log warning when a mid-run call hits a non-allowlisted PHP route."""
    path = urlparse(url).path or url
    for bad in MID_RUN_FORBIDDEN_SUFFIXES:
        if bad in path:
            logger.warning(
                "php_boundary: discouraged mid-run PHP call context=%s url=%s",
                context,
                url,
            )
            return
    if not any(path.endswith(suf) or suf in path for suf in ALLOWED_PHP_SUFFIXES):
        logger.debug("php_boundary: PHP call context=%s url=%s", context, url)
