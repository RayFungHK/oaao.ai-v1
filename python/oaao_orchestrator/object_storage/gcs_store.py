from __future__ import annotations

import json
from typing import Any

from oaao_orchestrator.object_storage.config import resolve_credentials_from_domain_config
from oaao_orchestrator.object_storage.locator import StorageLocator


class GCSStore:
    def __init__(self, domain_config: dict[str, Any]) -> None:
        from google.cloud import storage
        from google.oauth2 import service_account

        cred = resolve_credentials_from_domain_config(domain_config)
        bucket = str(domain_config.get("bucket") or "").strip()
        if not bucket:
            raise ValueError("gcs bucket required")
        self._bucket_name = bucket
        if cred.get("token"):
            info = json.loads(cred["token"])
            credentials = service_account.Credentials.from_service_account_info(info)
            project = cred.get("project") or info.get("project_id")
            self._client = storage.Client(project=project, credentials=credentials)
        else:
            self._client = storage.Client()
        self._bucket = self._client.bucket(bucket)

    def put_bytes(self, locator: StorageLocator, data: bytes) -> StorageLocator:
        blob = self._bucket.blob(locator.key)
        blob.upload_from_string(data)
        blob.reload()
        return StorageLocator(
            backend="gcs",
            key=locator.key,
            bucket=self._bucket_name,
            etag=blob.etag,
            size=blob.size or len(data),
        )

    def get_bytes(self, locator: StorageLocator) -> bytes:
        blob = self._bucket.blob(locator.key)
        return blob.download_as_bytes()

    def delete(self, locator: StorageLocator) -> None:
        self._bucket.blob(locator.key).delete()

    def exists(self, locator: StorageLocator) -> bool:
        return self._bucket.blob(locator.key).exists()

    def presign_get(self, locator: StorageLocator, ttl_sec: int = 3600) -> str:
        blob = self._bucket.blob(locator.key)
        return blob.generate_signed_url(expiration=max(60, min(86400, ttl_sec)), method="GET")
