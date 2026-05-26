"""W9-S1 / W9-S2 / W10-S1 / W10-S2 contract tests."""

from __future__ import annotations

import time

import pytest
from oaao_orchestrator.cache import (
    TTLCache,
    caches_snapshot,
    default_max_entries,
    default_ttl_seconds,
    key_for_query,
    register_cache,
)
from oaao_orchestrator.cors_config import resolve_cors_config
from oaao_orchestrator.profiling import (
    hot_path_timer,
    profiling_enabled,
    record,
    reset,
    snapshot,
)
from oaao_orchestrator.stream_token import (
    MAX_TOKEN_LEN,
    MIN_TOKEN_LEN,
    StreamTokenStore,
    is_valid_token_format,
)

# --------------------------------------------------------------------------- #
# W9-S1 profiling
# --------------------------------------------------------------------------- #


def test_profiling_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OAAO_PROFILING_ENABLED", raising=False)
    reset()
    assert profiling_enabled() is False
    with hot_path_timer("rag.retrieve"):
        pass
    assert snapshot() == {}


def test_profiling_records_when_enabled(monkeypatch):
    monkeypatch.setenv("OAAO_PROFILING_ENABLED", "1")
    reset()
    with hot_path_timer("rag.retrieve"):
        time.sleep(0.001)
    snap = snapshot()
    assert "rag.retrieve" in snap
    assert snap["rag.retrieve"]["count"] == 1.0
    assert snap["rag.retrieve"]["max_ms"] > 0.0


def test_profiling_percentiles(monkeypatch):
    monkeypatch.setenv("OAAO_PROFILING_ENABLED", "1")
    reset()
    for ms in [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]:
        record("asr.window", float(ms))
    snap = snapshot()["asr.window"]
    assert snap["count"] == 10.0
    assert snap["max_ms"] == 100.0
    assert snap["p95_ms"] >= snap["p50_ms"]


def test_profiling_records_even_on_exception(monkeypatch):
    monkeypatch.setenv("OAAO_PROFILING_ENABLED", "1")
    reset()
    with pytest.raises(RuntimeError):  # noqa: SIM117
        with hot_path_timer("slide.render"):
            raise RuntimeError("boom")
    assert snapshot()["slide.render"]["count"] == 1.0


# --------------------------------------------------------------------------- #
# W9-S2 cache
# --------------------------------------------------------------------------- #


def test_default_ttl_env(monkeypatch):
    monkeypatch.setenv("OAAO_CACHE_DEFAULT_TTL_SEC", "12.5")
    assert default_ttl_seconds() == 12.5


def test_default_ttl_invalid_returns_60(monkeypatch):
    monkeypatch.setenv("OAAO_CACHE_DEFAULT_TTL_SEC", "abc")
    assert default_ttl_seconds() == 60.0


def test_default_max_entries(monkeypatch):
    monkeypatch.setenv("OAAO_CACHE_DEFAULT_MAX_ENTRIES", "256")
    assert default_max_entries() == 256


def test_key_for_query_deterministic():
    k1 = key_for_query("hello", {"a": 1, "b": 2})
    k2 = key_for_query("hello", {"b": 2, "a": 1})
    assert k1 == k2
    assert len(k1) == 64


def test_key_for_query_handles_unjsonable():
    class _X:
        pass

    # Should not raise
    k = key_for_query(_X())
    assert len(k) == 64


def test_ttlcache_hit_miss():
    c = TTLCache[int](max_entries=4, ttl_seconds=60.0, name="t")
    assert c.get("a") is None
    c.set("a", 1)
    assert c.get("a") == 1
    assert c.stats.hits == 1
    assert c.stats.misses == 1


def test_ttlcache_lru_eviction():
    c = TTLCache[int](max_entries=2, ttl_seconds=60.0, name="lru")
    c.set("a", 1)
    c.set("b", 2)
    c.get("a")  # touch a
    c.set("c", 3)  # evict b
    assert c.get("b") is None
    assert c.get("a") == 1
    assert c.stats.evicted == 1


def test_ttlcache_expiry():
    c = TTLCache[int](max_entries=4, ttl_seconds=0.05, name="exp")
    c.set("k", 1)
    assert c.get("k") == 1
    time.sleep(0.08)
    assert c.get("k") is None
    assert c.stats.expired == 1


def test_ttlcache_invalidate_and_clear():
    c = TTLCache[int](max_entries=4, ttl_seconds=60.0, name="inv")
    c.set("a", 1)
    assert c.invalidate("a") is True
    assert c.invalidate("a") is False
    c.set("b", 2)
    c.clear()
    assert len(c) == 0


def test_cache_registry_snapshot():
    c = TTLCache[int](max_entries=4, ttl_seconds=60.0, name="snapshot-target")
    register_cache(c)
    c.set("a", 1)
    c.get("a")
    found = [s for s in caches_snapshot() if s["name"] == "snapshot-target"]
    assert found and found[0]["hits"] == 1


# --------------------------------------------------------------------------- #
# W10-S1 stream token
# --------------------------------------------------------------------------- #


def test_token_format_rejects_too_short():
    assert is_valid_token_format("a" * (MIN_TOKEN_LEN - 1)) is False


def test_token_format_rejects_too_long():
    assert is_valid_token_format("a" * (MAX_TOKEN_LEN + 1)) is False


def test_token_format_rejects_non_hex():
    assert is_valid_token_format("X" * 48) is False
    assert is_valid_token_format("../../etc/passwd" + "0" * 32) is False


def test_token_format_accepts_lowercase_hex():
    assert is_valid_token_format("0123456789abcdef" * 3) is True


def test_token_format_rejects_uppercase_hex():
    # secrets.token_hex returns lowercase; reject uppercase to keep one canonical form.
    assert is_valid_token_format("ABCDEF" * 8) is False


def test_token_format_rejects_non_string():
    assert is_valid_token_format(None) is False  # type: ignore[arg-type]
    assert is_valid_token_format(12345) is False  # type: ignore[arg-type]


def test_stream_token_store_mint_validate():
    store = StreamTokenStore(ttl_seconds=0.0)
    tok = store.mint("run-1")
    assert is_valid_token_format(tok)
    assert store.validate("run-1", tok) is True
    assert store.validate("run-1", tok.replace("a", "b", 1)) is False


def test_stream_token_store_rejects_unknown_subject():
    store = StreamTokenStore(ttl_seconds=0.0)
    assert store.validate("nope", "0" * 48) is False


def test_stream_token_store_ttl_expiry():
    store = StreamTokenStore(ttl_seconds=0.05)
    tok = store.mint("run-2")
    assert store.validate("run-2", tok) is True
    time.sleep(0.08)
    assert store.validate("run-2", tok) is False
    # Eager purge on expiry
    assert len(store) == 0


def test_stream_token_store_revoke():
    store = StreamTokenStore(ttl_seconds=0.0)
    tok = store.mint("run-3")
    assert store.revoke("run-3") is True
    assert store.revoke("run-3") is False
    assert store.validate("run-3", tok) is False


# --------------------------------------------------------------------------- #
# W10-S2 CORS
# --------------------------------------------------------------------------- #


def test_cors_localhost_default_when_unset():
    cfg = resolve_cors_config(env={})
    assert "http://localhost" in cfg.origins
    assert cfg.wildcard is False
    assert cfg.allow_credentials is False


def test_cors_custom_allowlist():
    cfg = resolve_cors_config(
        env={"OAAO_CORS_ALLOWED_ORIGINS": "https://app.example.com,https://api.example.com"}
    )
    assert cfg.origins == ("https://app.example.com", "https://api.example.com")
    assert cfg.wildcard is False


def test_cors_wildcard_requires_opt_in():
    cfg = resolve_cors_config(env={"OAAO_CORS_ALLOWED_ORIGINS": "*"})
    assert cfg.wildcard is False
    assert "http://localhost" in cfg.origins


def test_cors_wildcard_opt_in_forces_no_credentials():
    cfg = resolve_cors_config(
        env={
            "OAAO_CORS_ALLOWED_ORIGINS": "*",
            "OAAO_CORS_ALLOW_WILDCARD": "1",
            "OAAO_CORS_ALLOW_CREDENTIALS": "1",
        }
    )
    assert cfg.wildcard is True
    assert cfg.allow_credentials is False


def test_cors_credentials_only_with_explicit_allowlist():
    cfg = resolve_cors_config(
        env={
            "OAAO_CORS_ALLOWED_ORIGINS": "https://app.example.com",
            "OAAO_CORS_ALLOW_CREDENTIALS": "1",
        }
    )
    assert cfg.allow_credentials is True


def test_cors_middleware_kwargs_shape():
    cfg = resolve_cors_config(env={"OAAO_CORS_ALLOWED_ORIGINS": "https://x"})
    kwargs = cfg.as_middleware_kwargs()
    assert kwargs["allow_origins"] == ["https://x"]
    assert "OPTIONS" in kwargs["allow_methods"]
