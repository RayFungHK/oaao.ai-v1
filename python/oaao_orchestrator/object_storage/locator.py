from __future__ import annotations

from dataclasses import dataclass
from typing import Any


BACKENDS = frozenset({"local", "s3", "gcs", "hf"})


@dataclass(frozen=True)
class StorageLocator:
    backend: str
    key: str
    bucket: str | None = None
    region: str | None = None
    etag: str | None = None
    size: int | None = None
    local_root: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"backend": self.backend, "key": self.key}
        if self.bucket:
            out["bucket"] = self.bucket
        if self.region:
            out["region"] = self.region
        if self.etag:
            out["etag"] = self.etag
        if self.size is not None and self.size > 0:
            out["size"] = self.size
        if self.local_root:
            out["local_root"] = self.local_root
        return out


def parse_locator(raw: dict[str, Any] | None) -> StorageLocator | None:
    if not isinstance(raw, dict):
        return None
    backend = str(raw.get("backend") or "").strip().lower()
    key = str(raw.get("key") or "").lstrip("/")
    if backend not in BACKENDS or not key or ".." in key:
        return None
    return StorageLocator(
        backend=backend,
        key=key,
        bucket=str(raw["bucket"]).strip() if raw.get("bucket") else None,
        region=str(raw["region"]).strip() if raw.get("region") else None,
        etag=str(raw["etag"]).strip() if raw.get("etag") else None,
        size=int(raw["size"]) if raw.get("size") is not None else None,
        local_root=str(raw["local_root"]).strip() if raw.get("local_root") else None,
    )
