from __future__ import annotations

from typing import Any

from oaao_orchestrator.object_storage.config import resolve_credentials_from_domain_config
from oaao_orchestrator.object_storage.locator import StorageLocator


class S3Store:
    def __init__(self, domain_config: dict[str, Any]) -> None:
        import boto3

        cred = resolve_credentials_from_domain_config(domain_config)
        bucket = str(domain_config.get("bucket") or "").strip()
        if not bucket:
            raise ValueError("s3 bucket required")
        region = str(domain_config.get("region") or cred.get("region") or "us-east-1").strip()
        kwargs: dict[str, Any] = {"region_name": region}
        if cred.get("access_key") and cred.get("secret_key"):
            kwargs["aws_access_key_id"] = cred["access_key"]
            kwargs["aws_secret_access_key"] = cred["secret_key"]
        if cred.get("endpoint_url"):
            kwargs["endpoint_url"] = cred["endpoint_url"]
        self._bucket = bucket
        self._client = boto3.client("s3", **kwargs)

    def put_bytes(self, locator: StorageLocator, data: bytes) -> StorageLocator:
        key = locator.key
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)
        head = self._client.head_object(Bucket=self._bucket, Key=key)
        etag = str(head.get("ETag") or "").strip('"')
        size = int(head.get("ContentLength") or len(data))
        return StorageLocator(
            backend="s3",
            key=key,
            bucket=self._bucket,
            region=str(self._client.meta.region_name),
            etag=etag or None,
            size=size,
        )

    def get_bytes(self, locator: StorageLocator) -> bytes:
        bucket = locator.bucket or self._bucket
        resp = self._client.get_object(Bucket=bucket, Key=locator.key)
        body = resp["Body"].read()
        return bytes(body)

    def delete(self, locator: StorageLocator) -> None:
        bucket = locator.bucket or self._bucket
        self._client.delete_object(Bucket=bucket, Key=locator.key)

    def exists(self, locator: StorageLocator) -> bool:
        bucket = locator.bucket or self._bucket
        try:
            self._client.head_object(Bucket=bucket, Key=locator.key)
            return True
        except Exception:
            return False

    def presign_get(self, locator: StorageLocator, ttl_sec: int = 3600) -> str:
        bucket = locator.bucket or self._bucket
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": locator.key},
                ExpiresIn=max(60, min(86400, ttl_sec)),
            )
        )
