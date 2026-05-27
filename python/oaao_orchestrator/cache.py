"""W9-S2 — TTL+LRU cache for query→result hot paths.

Targets the small/medium-cardinality caches that show up in RAG retrieval
(query embedding → top-k doc IDs), ASR phrase-pack lookups, and slide
prompt selection. The cache is in-process per orchestrator instance; a
Redis-backed peer ships with W9-S3 once metrics confirm the hit rates
justify a network round-trip.

Design:
- Pure stdlib (`collections.OrderedDict`) — no third-party dep.
- Bounded by `max_entries` (LRU eviction) and `ttl_seconds` (lazy expiry).
- Thread-safe via a single `threading.Lock`; reads + writes are O(1).
- `key_for_query()` helper produces a deterministic SHA-256 hex digest so
  callers don't need to think about hashable composite keys.
- Env knobs apply only to defaults; explicit constructor args win.

Hot-reload / metrics will land in W9-S3.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


# --------------------------------------------------------------------------- #
# Env defaults
# --------------------------------------------------------------------------- #


def default_ttl_seconds() -> float:
    raw = (os.environ.get("OAAO_CACHE_DEFAULT_TTL_SEC") or "").strip()
    if not raw:
        return 60.0
    try:
        value = float(raw)
    except ValueError:
        return 60.0
    return max(0.0, value)


def default_max_entries() -> int:
    raw = (os.environ.get("OAAO_CACHE_DEFAULT_MAX_ENTRIES") or "").strip()
    if not raw:
        return 1024
    try:
        value = int(raw)
    except ValueError:
        return 1024
    return max(1, value)


# --------------------------------------------------------------------------- #
# Key helper
# --------------------------------------------------------------------------- #


def key_for_query(*parts: Any) -> str:
    """Deterministic SHA-256 hex digest over JSON-serialised parts.

    Non-JSON-serialisable parts fall back to `repr()`. The same input list
    in the same order always produces the same key.
    """

    def _safe(part: Any) -> Any:
        try:
            json.dumps(part)
            return part
        except (TypeError, ValueError):
            return repr(part)

    payload = json.dumps([_safe(p) for p in parts], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Cache
# --------------------------------------------------------------------------- #


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    expired: int = 0
    evicted: int = 0

    def snapshot(self) -> dict[str, int | float]:
        total = self.hits + self.misses
        hit_rate = (self.hits / total) if total else 0.0
        return {
            "hits": self.hits,
            "misses": self.misses,
            "expired": self.expired,
            "evicted": self.evicted,
            "hit_rate": round(hit_rate, 4),
        }


class TTLCache[T]:
    """Bounded TTL+LRU cache for query→result mappings.

    >>> c = TTLCache[int](max_entries=2, ttl_seconds=60.0, name="demo")
    >>> c.set("a", 1); c.set("b", 2); c.get("a")
    1
    """

    def __init__(
        self,
        *,
        max_entries: int | None = None,
        ttl_seconds: float | None = None,
        name: str = "anon",
    ) -> None:
        self._max = max_entries if max_entries is not None else default_max_entries()
        self._ttl = ttl_seconds if ttl_seconds is not None else default_ttl_seconds()
        self._name = name
        self._lock = threading.Lock()
        self._store: OrderedDict[str, tuple[float, T]] = OrderedDict()
        self.stats = CacheStats()

    def _is_expired(self, expiry: float, now: float) -> bool:
        return self._ttl > 0.0 and expiry <= now

    def get(self, key: str, default: T | None = None) -> T | None:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.stats.misses += 1
                return default
            expiry, value = entry
            if self._is_expired(expiry, now):
                del self._store[key]
                self.stats.expired += 1
                self.stats.misses += 1
                return default
            self._store.move_to_end(key)
            self.stats.hits += 1
            return value

    def set(self, key: str, value: T) -> None:
        expiry = time.monotonic() + self._ttl if self._ttl > 0 else float("inf")
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (expiry, value)
            while len(self._store) > self._max:
                self._store.popitem(last=False)
                self.stats.evicted += 1

    def invalidate(self, key: str) -> bool:
        with self._lock:
            return self._store.pop(key, None) is not None

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def name(self) -> str:
        return self._name

    def snapshot(self) -> dict[str, Any]:
        return {
            "name": self._name,
            "size": len(self),
            "max_entries": self._max,
            "ttl_seconds": self._ttl,
            **self.stats.snapshot(),
        }


# --------------------------------------------------------------------------- #
# Registry — for /v1/admin/cache snapshot
# --------------------------------------------------------------------------- #


_registry_lock = threading.Lock()
_caches: dict[str, TTLCache[Any]] = {}


def register_cache(cache: TTLCache[Any]) -> None:
    with _registry_lock:
        _caches[cache.name()] = cache


def caches_snapshot() -> list[dict[str, Any]]:
    with _registry_lock:
        return [c.snapshot() for c in _caches.values()]


def cache_backend_name() -> str:
    return (os.environ.get("OAAO_CACHE_BACKEND") or "memory").strip().lower() or "memory"


class RedisTTLCache[T]:
    """Optional Redis-backed TTL cache (W9-S3) — env-gated peer to in-process ``TTLCache``."""

    def __init__(
        self,
        *,
        name: str,
        url: str,
        ttl_seconds: float | None = None,
        max_entries: int | None = None,
    ) -> None:
        self._name = name
        self._url = url
        self._ttl = ttl_seconds if ttl_seconds is not None else default_ttl_seconds()
        self._max = max_entries if max_entries is not None else default_max_entries()
        self.stats = CacheStats()
        self._redis: Any = None

    def _client(self) -> Any:
        if self._redis is None:
            try:
                import redis
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError("redis package required for OAAO_CACHE_BACKEND=redis") from exc
            self._redis = redis.from_url(self._url, decode_responses=True)
        return self._redis

    def _key(self, key: str) -> str:
        return f"oaao:cache:{self._name}:{key}"

    def get(self, key: str, default: T | None = None) -> T | None:
        import json

        raw = self._client().get(self._key(key))
        if raw is None:
            self.stats.misses += 1
            return default
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            self.stats.misses += 1
            return default
        self.stats.hits += 1
        return value  # type: ignore[return-value]

    def set(self, key: str, value: T) -> None:
        import json

        payload = json.dumps(value, ensure_ascii=False)
        ttl = int(self._ttl) if self._ttl > 0 else None
        client = self._client()
        client.set(self._key(key), payload, ex=ttl)
        if self._max > 0:
            pattern = f"oaao:cache:{self._name}:*"
            keys = list(client.scan_iter(match=pattern, count=self._max + 8))
            if len(keys) > self._max:
                for stale in keys[: len(keys) - self._max]:
                    client.delete(stale)
                    self.stats.evicted += 1

    def invalidate(self, key: str) -> bool:
        return bool(self._client().delete(self._key(key)))

    def clear(self) -> None:
        client = self._client()
        for stale in client.scan_iter(match=f"oaao:cache:{self._name}:*", count=256):
            client.delete(stale)

    def __len__(self) -> int:
        return sum(
            1 for _ in self._client().scan_iter(match=f"oaao:cache:{self._name}:*", count=256)
        )

    def name(self) -> str:
        return self._name

    def snapshot(self) -> dict[str, Any]:
        return {
            "name": self._name,
            "backend": "redis",
            "size": len(self),
            "max_entries": self._max,
            "ttl_seconds": self._ttl,
            **self.stats.snapshot(),
        }


def make_ttl_cache[T](
    *,
    name: str,
    max_entries: int | None = None,
    ttl_seconds: float | None = None,
) -> TTLCache[T] | RedisTTLCache[T]:
    """Factory — ``OAAO_CACHE_BACKEND=redis`` + URL selects Redis peer."""
    if cache_backend_name() == "redis":
        url = (
            os.environ.get("OAAO_CACHE_REDIS_URL")
            or os.environ.get("OAAO_QUEUE_REDIS_URL")
            or ""
        ).strip()
        if url:
            cache: TTLCache[T] | RedisTTLCache[T] = RedisTTLCache(
                name=name,
                url=url,
                max_entries=max_entries,
                ttl_seconds=ttl_seconds,
            )
            register_cache(cache)  # type: ignore[arg-type]
            return cache
    cache = TTLCache(max_entries=max_entries, ttl_seconds=ttl_seconds, name=name)
    register_cache(cache)
    return cache
