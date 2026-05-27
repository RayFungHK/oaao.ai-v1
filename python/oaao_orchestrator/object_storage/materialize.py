from __future__ import annotations

import hashlib
import time
from pathlib import Path

from oaao_orchestrator.object_storage.config import merge_domain_config
from oaao_orchestrator.object_storage.local_store import LocalStore, cache_root
from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator


def materialize_locator(
    locator: StorageLocator,
    *,
    tenant_id: int,
    domain: str,
    domain_config: dict | None = None,
) -> str:
    if locator.backend == "local":
        root = locator.local_root
        store = LocalStore(domain, root)
        return store.absolute_path(locator)

    data = read_locator_bytes(locator, domain=domain, domain_config=domain_config or {})
    cache = cache_root() / str(max(0, tenant_id))
    cache.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"{locator.backend}:{locator.bucket}:{locator.key}".encode()).hexdigest()
    name = Path(locator.key).name or "blob"
    dest = cache / f"{digest}_{name}"
    dest.write_bytes(data)
    return str(dest.resolve())


def read_locator_bytes(locator: StorageLocator, *, domain: str, domain_config: dict) -> bytes:
    if locator.backend == "local":
        return LocalStore(domain, locator.local_root).get_bytes(locator)
    store = build_store(locator.backend, domain, domain_config)
    return store.get_bytes(locator)


def build_store(backend: str, domain: str, domain_config: dict):
    if backend == "local":
        return LocalStore(domain, domain_config.get("local_root"))
    if backend == "s3":
        from oaao_orchestrator.object_storage.s3_store import S3Store

        return S3Store(domain_config)
    if backend == "gcs":
        from oaao_orchestrator.object_storage.gcs_store import GCSStore

        return GCSStore(domain_config)
    if backend == "hf":
        from oaao_orchestrator.object_storage.hf_store import HFStore

        return HFStore(domain_config)
    raise ValueError(f"unsupported backend: {backend}")


def cache_sweep(max_age_sec: int = 86400) -> int:
    root = cache_root()
    if not root.is_dir():
        return 0
    cutoff = time.time() - max(60, max_age_sec)
    removed = 0
    for path in root.rglob("*"):
        if path.is_file() and path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed += 1
    return removed
