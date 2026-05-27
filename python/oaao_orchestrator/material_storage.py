"""Unified get_storage / save_storage for agent-generated conversation materials."""

from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

from oaao_orchestrator.object_storage.config import domain_local_root
from oaao_orchestrator.object_storage.local_store import LocalStore
from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import build_store, materialize_locator

DOMAIN = "agent_materials"


def relative_key(conversation_id: int, material_id: str, file_name: str) -> str:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", material_id.strip()) or "material"
    base = Path(file_name.strip().replace("\0", "")).name or "file.bin"
    return f"{max(0, conversation_id)}/{safe_id}/{base}"


def save_storage(
    *,
    conversation_id: int,
    material_id: str,
    data: bytes,
    file_name: str,
    domain_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cfg = domain_config or {}
    backend = str(cfg.get("backend") or "local").strip().lower()
    rel = relative_key(conversation_id, material_id, file_name)
    if backend == "local":
        root = str(cfg.get("local_root") or domain_local_root(DOMAIN))
        loc = StorageLocator(backend="local", key=rel, size=len(data), local_root=root)
        out = LocalStore(DOMAIN, root).put_bytes(loc, data)
    else:
        loc = StorageLocator(
            backend=backend,
            key=rel,
            bucket=str(cfg.get("bucket") or "").strip() or None,
            region=str(cfg.get("region") or "").strip() or None,
        )
        out = build_store(backend, DOMAIN, cfg).put_bytes(loc, data)
    return out.to_dict()


def get_storage(
    *,
    tenant_id: int,
    locator: dict[str, Any],
    domain_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    loc = parse_locator(locator)
    if loc is None:
        raise ValueError("invalid locator")
    cfg = domain_config or {}
    if loc.backend == "local":
        path = LocalStore(DOMAIN, loc.local_root).absolute_path(loc)
        return {"mode": "local", "absolute_path": path}
    store = build_store(loc.backend, DOMAIN, cfg)
    url = store.presign_get(loc) if hasattr(store, "presign_get") else None
    if url:
        return {"mode": "redirect", "url": url}
    path = materialize_locator(loc, tenant_id=tenant_id, domain=DOMAIN, domain_config=cfg)
    return {"mode": "local", "absolute_path": path}


def persist_artifact_dict(
    *,
    conversation_id: int,
    artifact: dict[str, Any],
    domain_config: dict[str, Any] | None = None,
    prefer_material_id: bool = False,
) -> dict[str, Any]:
    if isinstance(artifact.get("storage_locator"), dict):
        return artifact
    material_id = (
        str(artifact.get("material_id") or "").strip()
        if prefer_material_id
        else str(artifact.get("id") or artifact.get("material_id") or "").strip()
    )
    if not material_id:
        return artifact
    name = str(artifact.get("name") or artifact.get("title") or "file.bin").strip() or "file.bin"
    data: bytes | None = None
    b64 = str(artifact.get("image_base64") or artifact.get("b64") or "").strip()
    if b64:
        try:
            data = base64.b64decode(b64)
        except Exception:
            data = None
    if data is None:
        path = str(artifact.get("path") or artifact.get("output_path") or "").strip()
        if path:
            p = Path(path)
            if p.is_file():
                data = p.read_bytes()
    if not data:
        return artifact
    loc = save_storage(
        conversation_id=conversation_id,
        material_id=material_id,
        data=data,
        file_name=name,
        domain_config=domain_config,
    )
    out = dict(artifact)
    out["storage_locator"] = loc
    out["size_bytes"] = len(data)
    if not out.get("mime"):
        out["mime"] = "application/octet-stream"
    return out


def persist_meta_artifacts(
    meta: dict[str, Any],
    *,
    conversation_id: int,
    domain_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out = dict(meta)
    pipe = out.get("oaao_pipeline")
    if isinstance(pipe, dict) and isinstance(pipe.get("artifacts"), list):
        pipe = dict(pipe)
        pipe["artifacts"] = [
            persist_artifact_dict(
                conversation_id=conversation_id,
                artifact=a,
                domain_config=domain_config,
            )
            if isinstance(a, dict)
            else a
            for a in pipe["artifacts"]
        ]
        out["oaao_pipeline"] = pipe
    mats = out.get("materials")
    if isinstance(mats, list):
        out["materials"] = [
            persist_artifact_dict(
                conversation_id=conversation_id,
                artifact=m,
                domain_config=domain_config,
                prefer_material_id=True,
            )
            if isinstance(m, dict)
            else m
            for m in mats
        ]
    return out
