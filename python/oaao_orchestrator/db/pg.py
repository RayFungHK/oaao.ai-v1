"""PostgreSQL pool for orchestrator (vault jobs) — read OAAO_PG_URL."""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

_pool: Any = None


def parse_pg_url(url: str) -> dict[str, Any] | None:
    parts = urlparse(url.strip())
    scheme = (parts.scheme or "").lower()
    if scheme not in ("postgresql", "postgres"):
        return None
    dbname = (parts.path or "").lstrip("/")
    if not dbname:
        return None
    return {
        "host": parts.hostname or "localhost",
        "port": int(parts.port or 5432),
        "dbname": dbname,
        "user": unquote(parts.username or ""),
        "password": unquote(parts.password or ""),
    }


def pg_dsn() -> str | None:
    from oaao_orchestrator.php_boundary import pg_url

    raw = pg_url()
    if not raw:
        return None
    parsed = parse_pg_url(raw)
    if parsed is None:
        return None
    return (
        f"host={parsed['host']} port={parsed['port']} dbname={parsed['dbname']} "
        f"user={parsed['user']} password={parsed['password']}"
    )


def pool_available() -> bool:
    return pg_dsn() is not None


def _ensure_pool() -> Any:
    global _pool
    if _pool is not None:
        return _pool
    dsn = pg_dsn()
    if dsn is None:
        raise RuntimeError("OAAO_PG_URL not configured")
    try:
        from psycopg_pool import ConnectionPool
    except ImportError as exc:
        raise RuntimeError("psycopg_pool not installed") from exc
    min_size = max(1, int(os.environ.get("OAAO_PG_POOL_MIN", "1")))
    max_size = max(min_size, int(os.environ.get("OAAO_PG_POOL_MAX", "4")))
    _pool = ConnectionPool(
        conninfo=dsn,
        min_size=min_size,
        max_size=max_size,
        kwargs={"autocommit": False},
        open=True,
    )
    logger.info("postgres pool ready for vault job claim")
    return _pool


@contextmanager
def pg_connection() -> Generator[Any, None, None]:
    pool = _ensure_pool()
    with pool.connection() as conn:
        yield conn
