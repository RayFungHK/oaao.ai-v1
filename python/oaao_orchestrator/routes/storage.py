"""Internal storage API — PHP cloud proxy + materialization."""

from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from oaao_orchestrator.object_storage.config import merge_domain_config
from oaao_orchestrator.object_storage.local_store import LocalStore
from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import build_store, materialize_locator
from oaao_orchestrator.object_storage.migrate import migrate_one_object
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(
    prefix="/v1/admin/storage",
    tags=["storage"],
    dependencies=[Depends(require_internal_token)],
)


class StorageRequest(BaseModel):
    tenant_id: int = 0
    domain: str = "vault"
    domain_config: dict[str, Any] = Field(default_factory=dict)
    locator: dict[str, Any] = Field(default_factory=dict)
    content_b64: str | None = None
    ttl_sec: int = 3600


class MigrateBatchRequest(BaseModel):
    tenant_id: int
    domain: str
    src_domain_config: dict[str, Any] = Field(default_factory=dict)
    dst_domain_config: dict[str, Any] = Field(default_factory=dict)
    items: list[dict[str, Any]] = Field(default_factory=list)
    purge_source: bool = False


def _locator(body: StorageRequest) -> StorageLocator:
    loc = parse_locator(body.locator)
    if loc is None:
        raise HTTPException(status_code=400, detail="invalid_locator")
    return loc


def _store(body: StorageRequest):
    cfg = body.domain_config or {}
    backend = str(cfg.get("backend") or "local").strip().lower()
    return build_store(backend, body.domain, cfg)


@router.post("/put")
async def storage_put(body: StorageRequest) -> dict[str, Any]:
    loc = _locator(body)
    if not body.content_b64:
        raise HTTPException(status_code=400, detail="content_b64 required")
    try:
        data = base64.b64decode(body.content_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_base64") from exc
    if loc.backend == "local":
        out = LocalStore(body.domain, loc.local_root).put_bytes(loc, data)
    else:
        out = _store(body).put_bytes(loc, data)
    return {"ok": True, "locator": out.to_dict()}


@router.post("/delete")
async def storage_delete(body: StorageRequest) -> dict[str, Any]:
    loc = _locator(body)
    if loc.backend == "local":
        LocalStore(body.domain, loc.local_root).delete(loc)
    else:
        _store(body).delete(loc)
    return {"ok": True}


@router.post("/exists")
async def storage_exists(body: StorageRequest) -> dict[str, Any]:
    loc = _locator(body)
    if loc.backend == "local":
        exists = LocalStore(body.domain, loc.local_root).exists(loc)
    else:
        exists = _store(body).exists(loc)
    return {"ok": True, "exists": exists}


@router.post("/presign")
async def storage_presign(body: StorageRequest) -> dict[str, Any]:
    from oaao_orchestrator.object_storage.cdn_delivery import delivery_url

    loc = _locator(body)
    cfg = body.domain_config or {}
    if loc.backend == "local":
        abs_path = LocalStore(body.domain, loc.local_root).absolute_path(loc)
        return {"ok": True, "url": None, "absolute_path": abs_path, "delivery": "local"}
    store = _store(body)
    origin_url: str | None = None
    if hasattr(store, "presign_get"):
        origin_url = store.presign_get(loc, ttl_sec=body.ttl_sec)
    cdn_url = delivery_url(loc, cfg, ttl_sec=body.ttl_sec, origin_presign_url=origin_url)
    if cdn_url:
        provider = str(cfg.get("cdn_provider") or "none").strip().lower()
        return {"ok": True, "url": cdn_url, "delivery": provider if provider != "none" else "origin"}
    if origin_url:
        return {"ok": True, "url": origin_url, "delivery": "origin"}
    abs_path = materialize_locator(
        loc,
        tenant_id=body.tenant_id,
        domain=body.domain,
        domain_config=cfg,
    )
    return {"ok": True, "url": None, "absolute_path": abs_path, "delivery": "materialize"}


@router.post("/materialize")
async def storage_materialize(body: StorageRequest) -> dict[str, Any]:
    loc = _locator(body)
    abs_path = materialize_locator(
        loc,
        tenant_id=body.tenant_id,
        domain=body.domain,
        domain_config=body.domain_config,
    )
    return {"ok": True, "absolute_path": abs_path}


@router.post("/test")
async def storage_test(body: StorageRequest) -> dict[str, Any]:
    cfg = body.domain_config or {}
    backend = str(cfg.get("backend") or "local").strip().lower()
    if backend == "local":
        root = LocalStore(body.domain).root
        return {"ok": True, "backend": backend, "local_root": str(root), "writable": root.exists()}
    store = _store(body)
    probe_key = f"__oaao_probe/{body.tenant_id}/ping.txt"
    probe = StorageLocator(backend=backend, key=probe_key, bucket=str(cfg.get("bucket") or "") or None)
    out = store.put_bytes(probe, b"ok")
    store.delete(out)
    return {"ok": True, "backend": backend}


@router.post("/migrate-batch")
async def storage_migrate_batch(body: MigrateBatchRequest) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for item in body.items[:50]:
        try:
            results.append(
                migrate_one_object(
                    tenant_id=body.tenant_id,
                    domain=body.domain,
                    item=item,
                    src_domain_config=body.src_domain_config,
                    dst_domain_config=body.dst_domain_config,
                    purge_source=body.purge_source,
                )
            )
        except Exception as exc:
            results.append({"ok": False, "error": str(exc), "object_id": item.get("object_id")})
    done = sum(1 for r in results if r.get("ok"))
    failed = len(results) - done
    return {"ok": True, "results": results, "done": done, "failed": failed}
