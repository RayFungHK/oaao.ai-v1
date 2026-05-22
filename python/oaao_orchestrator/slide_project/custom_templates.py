"""User-imported slide templates — JSON manifest + on-disk preview slides (scoped)."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from oaao_orchestrator.slide_project.template_scope import (
    TemplateScopeContext,
    TemplateScopeLevel,
    can_read_template,
    can_write_scope,
    normalize_scope,
    partition_ids,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{2,48}$")
STATUSES = frozenset({"draft", "preview", "published"})


def _distributor_data_dir() -> Path:
    return Path("/var/www/html/sites/oaaoai/oaaoai/data")


def _default_custom_templates_root() -> Path:
    return _distributor_data_dir() / "slide-templates" / "custom"


def _legacy_custom_templates_root() -> Path:
    return Path("/var/www/html/sites/oaaoai/oaaoai/auth/data/slide-templates/custom")


def custom_templates_root() -> Path:
    env = (os.environ.get("OAAO_SLIDE_TEMPLATE_CUSTOM_ROOT") or "").strip()
    if env:
        return Path(env)
    preferred = _default_custom_templates_root()
    legacy = _legacy_custom_templates_root()
    if preferred.is_dir() or not legacy.is_dir():
        return preferred
    return legacy


def incoming_dir() -> Path:
    path = custom_templates_root() / "incoming"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _scope_base(scope: TemplateScopeLevel, tenant_id: int | None, owner_user_id: int | None) -> Path:
    root = custom_templates_root()
    if scope == "global":
        return root / "global"
    if scope == "tenant":
        tid = int(tenant_id or 0)
        return root / "tenant" / str(max(1, tid))
    uid = int(owner_user_id or 0)
    return root / "personal" / str(max(1, uid))


def template_json_path(
    template_id: str,
    *,
    scope: TemplateScopeLevel,
    tenant_id: int | None = None,
    owner_user_id: int | None = None,
) -> Path:
    base = _scope_base(scope, tenant_id, owner_user_id)
    return base / f"{safe_template_id(template_id)}.json"


def template_preview_root(
    template_id: str,
    *,
    scope: TemplateScopeLevel,
    tenant_id: int | None = None,
    owner_user_id: int | None = None,
) -> Path:
    base = _scope_base(scope, tenant_id, owner_user_id)
    return base / safe_template_id(template_id) / "preview"


def safe_template_id(raw: str) -> str:
    base = re.sub(r"[^a-z0-9_]", "", (raw or "").strip().lower())
    if base and _TEMPLATE_ID_RE.match(base):
        return base
    return f"imported_{uuid.uuid4().hex[:10]}"


def allocate_import_template_id(*, label: str | None = None, pptx_stem: str | None = None) -> str:
    """Fresh id per upload so gallery never stacks duplicate cards for the same stem."""
    stem = (pptx_stem or "").strip()
    if stem.lower().endswith(".pptx"):
        stem = Path(stem).stem
    hint = safe_template_id(stem or label or "")
    if hint.startswith("import_"):
        hint = hint[7:] or "deck"
    if hint.startswith("imported_") and len(hint) > 20:
        hint = "deck"
    if hint in ("imported_deck", "deck", ""):
        hint = "deck"
    suffix = uuid.uuid4().hex[:8]
    tid = f"import_{hint}_{suffix}"
    return tid[:49] if len(tid) > 49 else tid


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _iter_json_paths(ctx: TemplateScopeContext) -> Iterator[Path]:
    root = custom_templates_root()
    uid = ctx.user_id
    tid = ctx.tenant_id

    if uid > 0:
        personal = root / "personal" / str(uid)
        if personal.is_dir():
            yield from sorted(personal.glob("*.json"))

    if tid is not None and tid > 0:
        tenant_dir = root / "tenant" / str(tid)
        if tenant_dir.is_dir():
            yield from sorted(tenant_dir.glob("*.json"))

    global_dir = root / "global"
    if global_dir.is_dir():
        yield from sorted(global_dir.glob("*.json"))

    yield from sorted(root.glob("*.json"))


def _location_from_path(path: Path) -> tuple[TemplateScopeLevel, int | None, int | None]:
    parts = path.parts
    try:
        idx = parts.index("custom")
    except ValueError:
        return "personal", None, None
    tail = parts[idx + 1 :]
    if len(tail) >= 2 and tail[0] == "global":
        return "global", None, None
    if len(tail) >= 3 and tail[0] == "tenant" and tail[1].isdigit():
        return "tenant", int(tail[1]), None
    if len(tail) >= 3 and tail[0] == "personal" and tail[1].isdigit():
        return "personal", None, int(tail[1])
    return "personal", None, None


def resolve_template_record(
    template_id: str,
    ctx: TemplateScopeContext,
) -> tuple[dict[str, Any], Path] | None:
    tid = safe_template_id(template_id)
    for path in _iter_json_paths(ctx):
        if path.stem != tid:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        row = _enrich_summary(dict(data), path.stem)
        if not can_read_template(ctx, row):
            continue
        scope, row_tid, owner = _location_from_path(path)
        row.setdefault("scope", scope)
        if row_tid is not None:
            row.setdefault("tenant_id", row_tid)
        if owner is not None:
            row.setdefault("owner_user_id", owner)
        return row, path
    return None


def list_custom_templates(
    ctx: TemplateScopeContext,
    *,
    published_only: bool = False,
    scope_filter: TemplateScopeLevel | None = None,
) -> list[dict[str, Any]]:
    root = custom_templates_root()
    root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in _iter_json_paths(ctx):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            row = _enrich_summary(dict(data), path.stem)
            scope, row_tid, owner = _location_from_path(path)
            row.setdefault("scope", scope)
            if row_tid is not None:
                row.setdefault("tenant_id", row_tid)
            if owner is not None:
                row.setdefault("owner_user_id", owner)

            if scope_filter is not None and row.get("scope") != scope_filter:
                continue
            if not can_read_template(ctx, row):
                continue
            if published_only and row.get("status") != "published":
                continue

            tid = str(row.get("template_id") or path.stem)
            dedupe = f"{row.get('scope')}:{tid}"
            if dedupe in seen:
                continue
            seen.add(dedupe)
            row["template_id"] = tid
            out.append(row)
        except (json.JSONDecodeError, OSError):
            continue

    def _sort_key(r: dict[str, Any]) -> tuple[str, str]:
        return (str(r.get("updated_at") or ""), str(r.get("label") or r.get("template_id")))

    return sorted(out, key=_sort_key, reverse=True)


def _enrich_summary(data: dict[str, Any], stem: str) -> dict[str, Any]:
    tid = str(data.get("template_id") or stem)
    data.setdefault("template_id", tid)
    data.setdefault("source", "custom")
    data.setdefault("status", "draft")
    data.setdefault("scope", "personal")
    data.setdefault("thumbnail_source", "auto")
    data.setdefault("thumbnail_page", 1)
    manifest = _load_preview_manifest_for_row(data)
    if not str(data.get("preview_mode") or "").strip() and isinstance(manifest.get("preview_mode"), str):
        data["preview_mode"] = manifest["preview_mode"]
    pages = data.get("preview_pages")
    if not isinstance(pages, list):
        pages = manifest.get("pages") or []
        data["preview_pages"] = pages
    data["preview_count"] = len(pages) if isinstance(pages, list) else 0
    return data


def _load_preview_manifest_for_row(data: dict[str, Any]) -> dict[str, Any]:
    tid = str(data.get("template_id") or "")
    scope = normalize_scope(str(data.get("scope") or "personal"))
    tenant_id = data.get("tenant_id")
    owner = data.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    return _load_preview_manifest(tid, scope=scope, tenant_id=tid_i, owner_user_id=owner_i)


def _template_json_candidates(template_id: str) -> list[Path]:
    tid = safe_template_id(template_id)
    root = custom_templates_root()
    candidates: list[Path] = [
        root / "global" / f"{tid}.json",
        root / f"{tid}.json",
    ]
    tenant_root = root / "tenant"
    if tenant_root.is_dir():
        for tenant_dir in sorted(tenant_root.iterdir()):
            if tenant_dir.is_dir():
                candidates.append(tenant_dir / f"{tid}.json")
    personal_root = root / "personal"
    if personal_root.is_dir():
        for user_dir in sorted(personal_root.iterdir()):
            if user_dir.is_dir():
                candidates.append(user_dir / f"{tid}.json")
    return candidates


def resolve_template_json_path(template_id: str) -> Path | None:
    """First on-disk JSON path for a custom template id."""
    for path in _template_json_candidates(template_id):
        if path.is_file():
            return path
    return None


def resolve_template_asset_dir(template_id: str) -> Path | None:
    """Directory holding ``masters/``, ``preview/``, ``materials/`` for a template."""
    path = resolve_template_json_path(template_id)
    if path is None:
        return None
    scope, tenant_id, owner_user_id = _location_from_path(path)
    asset = _scope_base(scope, tenant_id, owner_user_id) / path.stem
    return asset if asset.is_dir() else None


def load_custom_template_by_id(template_id: str) -> dict[str, Any] | None:
    """Resolve template JSON on disk (deck pipeline / theme lookup — no ACL)."""
    path = resolve_template_json_path(template_id)
    if path is None:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return _enrich_summary(dict(data), path.stem)
    except (json.JSONDecodeError, OSError):
        return None
    return None


def list_published_template_ids() -> list[str]:
    """All published custom template ids (catalog / theme union)."""
    root = custom_templates_root()
    root.mkdir(parents=True, exist_ok=True)
    ids: set[str] = set()
    for path in root.rglob("*.json"):
        if path.parent.name == "incoming":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            if str(data.get("status") or "") != "published":
                continue
            tid = str(data.get("template_id") or path.stem).strip()
            if tid:
                ids.add(tid)
        except (json.JSONDecodeError, OSError):
            continue
    return sorted(ids)


def load_custom_template(template_id: str, ctx: TemplateScopeContext) -> dict[str, Any] | None:
    resolved = resolve_template_record(template_id, ctx)
    if resolved is None:
        return None
    return resolved[0]


def save_custom_template(
    payload: dict[str, Any],
    ctx: TemplateScopeContext,
    *,
    write_scope: TemplateScopeLevel | None = None,
) -> dict[str, Any]:
    scope = normalize_scope(write_scope or str(payload.get("scope") or "personal"))
    if not can_write_scope(ctx, scope):
        raise PermissionError(f"cannot_write_scope:{scope}")

    scope, tenant_id, owner_user_id = partition_ids(ctx, scope)
    root = _scope_base(scope, tenant_id, owner_user_id)
    root.mkdir(parents=True, exist_ok=True)

    tid = safe_template_id(str(payload.get("template_id") or ""))
    normalized = dict(payload)
    normalized["template_id"] = tid
    normalized["source"] = "custom"
    normalized["scope"] = scope
    normalized["tenant_id"] = tenant_id
    normalized["owner_user_id"] = owner_user_id if scope == "personal" else None
    normalized.setdefault("created_by", ctx.user_id)
    normalized.setdefault("status", "draft")
    normalized["updated_at"] = _utc_now()
    if normalized.get("status") == "published" and not normalized.get("published_at"):
        normalized["published_at"] = _utc_now()

    path = template_json_path(
        tid,
        scope=scope,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
    )
    path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def update_template_fields(
    template_id: str,
    patch: dict[str, Any],
    ctx: TemplateScopeContext,
) -> dict[str, Any] | None:
    resolved = resolve_template_record(template_id, ctx)
    if resolved is None:
        return None
    current, _path = resolved
    if not can_write_scope(ctx, normalize_scope(str(current.get("scope") or "personal"))):
        if int(current.get("created_by") or 0) != ctx.user_id and not ctx.is_platform_operator:
            raise PermissionError("cannot_update_template")
    merged = {**current, **patch, "template_id": current["template_id"]}
    scope = normalize_scope(str(merged.get("scope") or "personal"))
    return save_custom_template(merged, ctx, write_scope=scope)


def delete_custom_template(template_id: str, ctx: TemplateScopeContext) -> None:
    """Remove custom template JSON, preview tree, and optional assets."""
    resolved = resolve_template_record(template_id, ctx)
    if resolved is None:
        raise FileNotFoundError(f"template not found: {template_id}")
    current, json_path = resolved
    if str(current.get("source") or "custom") != "custom":
        raise ValueError("cannot_delete_builtin_template")

    scope = normalize_scope(str(current.get("scope") or "personal"))
    if not can_write_scope(ctx, scope):
        owner = int(current.get("created_by") or current.get("owner_user_id") or 0)
        if owner != ctx.user_id and not ctx.is_platform_operator:
            raise PermissionError("cannot_delete_template")

    tid = safe_template_id(str(current.get("template_id") or template_id))
    tenant_id = current.get("tenant_id")
    owner = current.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    asset_dir = _scope_base(scope, tid_i, owner_i) / tid

    if json_path.is_file():
        json_path.unlink()
    if asset_dir.is_dir():
        shutil.rmtree(asset_dir)


def preview_manifest_path(
    template_id: str,
    *,
    scope: TemplateScopeLevel,
    tenant_id: int | None = None,
    owner_user_id: int | None = None,
) -> Path:
    return template_preview_root(
        template_id,
        scope=scope,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
    ) / "preview_manifest.json"


def _load_preview_manifest(
    template_id: str,
    *,
    scope: TemplateScopeLevel,
    tenant_id: int | None = None,
    owner_user_id: int | None = None,
) -> dict[str, Any]:
    path = preview_manifest_path(
        template_id,
        scope=scope,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
    )
    if not path.is_file():
        return {"pages": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"pages": []}
    except (json.JSONDecodeError, OSError):
        return {"pages": []}


def save_preview_manifest(template_id: str, manifest: dict[str, Any], row: dict[str, Any]) -> None:
    scope = normalize_scope(str(row.get("scope") or "personal"))
    tenant_id = row.get("tenant_id")
    owner = row.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    root = template_preview_root(
        template_id,
        scope=scope,
        tenant_id=tid_i,
        owner_user_id=owner_i,
    )
    root.mkdir(parents=True, exist_ok=True)
    preview_manifest_path(
        template_id,
        scope=scope,
        tenant_id=tid_i,
        owner_user_id=owner_i,
    ).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def preview_slide_path(template_id: str, page: int, row: dict[str, Any]) -> Path:
    scope = normalize_scope(str(row.get("scope") or "personal"))
    tenant_id = row.get("tenant_id")
    owner = row.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    return template_preview_root(
        template_id,
        scope=scope,
        tenant_id=tid_i,
        owner_user_id=owner_i,
    ) / f"slides/{page:02d}/slide.html"


def resolve_preview_html_path(template_id: str, page: int, ctx: TemplateScopeContext) -> Path | None:
    resolved = resolve_template_record(template_id, ctx)
    if resolved is None:
        return None
    row, _path = resolved
    manifest = _load_preview_manifest_for_row(row)
    rel = f"slides/{page:02d}/slide.html"
    for p in manifest.get("pages") or []:
        if isinstance(p, dict) and int(p.get("index") or 0) == page:
            rel = str(p.get("html_path") or rel)
            break
    scope = normalize_scope(str(row.get("scope") or "personal"))
    tenant_id = row.get("tenant_id")
    owner = row.get("owner_user_id")
    tid_i = int(tenant_id) if tenant_id is not None and str(tenant_id).strip().isdigit() else None
    owner_i = int(owner) if owner is not None and str(owner).strip().isdigit() else None
    path = template_preview_root(
        template_id,
        scope=scope,
        tenant_id=tid_i,
        owner_user_id=owner_i,
    ) / rel.lstrip("/")
    return path if path.is_file() else None
