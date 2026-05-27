from __future__ import annotations

import os
from pathlib import Path

from oaao_orchestrator.object_storage.config import domain_local_root
from oaao_orchestrator.object_storage.locator import StorageLocator


class LocalStore:
    def __init__(self, domain: str, local_root: str | None = None) -> None:
        self.domain = domain
        self.root = Path(local_root or domain_local_root(domain))

    def _abs(self, locator: StorageLocator) -> Path:
        root = Path(locator.local_root or self.root)
        return root / locator.key

    def put_bytes(self, locator: StorageLocator, data: bytes) -> StorageLocator:
        path = self._abs(locator)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        root = str(locator.local_root or self.root)
        return StorageLocator(
            backend="local",
            key=locator.key,
            size=len(data),
            local_root=root,
        )

    def get_bytes(self, locator: StorageLocator) -> bytes:
        return self._abs(locator).read_bytes()

    def delete(self, locator: StorageLocator) -> None:
        path = self._abs(locator)
        if path.is_file():
            path.unlink()

    def exists(self, locator: StorageLocator) -> bool:
        return self._abs(locator).is_file()

    def absolute_path(self, locator: StorageLocator) -> str:
        path = self._abs(locator)
        if not path.is_file():
            raise FileNotFoundError(str(path))
        return str(path.resolve())


def cache_root() -> Path:
    raw = os.getenv("OAAO_STORAGE_CACHE_ROOT", "/tmp/oaao-storage-cache").strip()
    return Path(raw)
