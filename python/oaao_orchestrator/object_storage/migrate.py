from __future__ import annotations

from typing import Any

from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import build_store, read_locator_bytes
from oaao_orchestrator.object_storage.purge import purge_locator


def migrate_one_object(
    *,
    tenant_id: int,
    domain: str,
    item: dict[str, Any],
    src_domain_config: dict[str, Any],
    dst_domain_config: dict[str, Any],
    purge_source: bool = False,
) -> dict[str, Any]:
    del tenant_id
    object_id = str(item.get("object_id") or "")
    src = parse_locator(item.get("src_locator") if isinstance(item.get("src_locator"), dict) else None)
    if src is None:
        raise ValueError("invalid src_locator")
    dst_backend = str(dst_domain_config.get("backend") or "local").strip().lower()
    dst = StorageLocator(
        backend=dst_backend,
        key=src.key,
        bucket=str(dst_domain_config.get("bucket") or "").strip() or None,
        region=str(dst_domain_config.get("region") or "").strip() or None,
    )
    data = read_locator_bytes(src, domain=domain, domain_config=src_domain_config)
    if dst_backend == "local":
        from oaao_orchestrator.object_storage.local_store import LocalStore

        out = LocalStore(domain).put_bytes(dst, data)
    else:
        out = build_store(dst_backend, domain, dst_domain_config).put_bytes(dst, data)
    if len(data) != (out.size or len(data)):
        raise ValueError("size mismatch after copy")
    purged = False
    if purge_source:
        try:
            purge_locator(src, domain=domain, domain_config=src_domain_config)
            purged = True
        except Exception as exc:
            raise ValueError(f"purge_source failed: {exc}") from exc
    return {
        "ok": True,
        "object_id": object_id,
        "dst_locator": out.to_dict(),
        "byte_size": len(data),
        "source_purged": purged,
    }
