from __future__ import annotations

from typing import Any

from oaao_orchestrator.object_storage.config import resolve_credentials_from_domain_config
from oaao_orchestrator.object_storage.locator import StorageLocator


class HFStore:
    """Hugging Face Storage Buckets via huggingface_hub."""

    def __init__(self, domain_config: dict[str, Any]) -> None:
        from huggingface_hub import HfApi

        cred = resolve_credentials_from_domain_config(domain_config)
        token = cred.get("token") or cred.get("access_key")
        if not token:
            raise ValueError("HF credentials_env must define _TOKEN or _ACCESS_KEY")
        bucket = str(domain_config.get("bucket") or "").strip()
        if not bucket:
            raise ValueError("hf bucket required")
        self._bucket = bucket
        self._api = HfApi(token=token)

    def put_bytes(self, locator: StorageLocator, data: bytes) -> StorageLocator:
        path_in_repo = locator.key
        self._api.upload_file(
            path_or_fileobj=data,
            path_in_repo=path_in_repo,
            repo_id=self._bucket,
            repo_type="dataset",
        )
        return StorageLocator(
            backend="hf",
            key=locator.key,
            bucket=self._bucket,
            size=len(data),
        )

    def get_bytes(self, locator: StorageLocator) -> bytes:
        from huggingface_hub import hf_hub_download
        from pathlib import Path

        path = hf_hub_download(
            repo_id=locator.bucket or self._bucket,
            filename=locator.key,
            repo_type="dataset",
        )
        return Path(path).read_bytes()

    def delete(self, locator: StorageLocator) -> None:
        self._api.delete_file(
            path_in_repo=locator.key,
            repo_id=self._bucket,
            repo_type="dataset",
        )

    def exists(self, locator: StorageLocator) -> bool:
        try:
            self._api.hf_hub_download(
                repo_id=self._bucket,
                filename=locator.key,
                repo_type="dataset",
            )
            return True
        except Exception:
            return False

    def presign_get(self, locator: StorageLocator, ttl_sec: int = 3600) -> str | None:
        del ttl_sec
        return None
