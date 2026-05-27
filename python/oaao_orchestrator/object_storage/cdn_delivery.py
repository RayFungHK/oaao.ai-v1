"""CDN delivery URLs for cold-storage reads (CloudFront, GCS CDN, Cloudflare R2+CDN)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

from oaao_orchestrator.object_storage.config import resolve_credentials
from oaao_orchestrator.object_storage.locator import StorageLocator

CDN_PROVIDERS = frozenset({"none", "generic", "cloudfront", "gcs", "cloudflare"})


def _cdn_signing(prefix: str) -> dict[str, str]:
    if not prefix.strip():
        return {}
    out: dict[str, str] = {}
    for suffix in (
        "KEY_PAIR_ID",
        "PRIVATE_KEY",
        "KEY_NAME",
        "KEY_VALUE",
        "SIGNING_KEY",
        "TOKEN",
    ):
        val = os.getenv(f"{prefix.strip()}_{suffix}", "").strip()
        if val:
            out[suffix.lower()] = val.replace("\\n", "\n")
    return out


def _object_path_url(cdn_base_url: str, key: str) -> str:
    base = cdn_base_url.rstrip("/")
    path = quote(key.lstrip("/"), safe="/~")
    return f"{base}/{path}"


def _cloudfront_signed(url: str, cred: dict[str, str], ttl_sec: int) -> str:
    from botocore.signers import CloudFrontSigner
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key_id = cred.get("key_pair_id") or cred.get("key_name") or ""
    pem = cred.get("private_key") or cred.get("signing_key") or ""
    if not key_id or not pem:
        raise ValueError("cloudfront signing requires KEY_PAIR_ID and PRIVATE_KEY in cdn_signing_env")

    private_key = serialization.load_pem_private_key(
        pem.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )

    def rsa_signer(message: bytes) -> bytes:
        return private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())

    expire = datetime.now(UTC) + timedelta(seconds=max(60, min(86400, ttl_sec)))
    signer = CloudFrontSigner(key_id, rsa_signer)
    return str(signer.generate_presigned_url(url, date_less_than=expire))


def _gcs_cdn_signed(url: str, cred: dict[str, str], ttl_sec: int) -> str:
    key_name = cred.get("key_name") or ""
    key_value = cred.get("key_value") or cred.get("signing_key") or ""
    if not key_name or not key_value:
        raise ValueError("gcs cdn signing requires KEY_NAME and KEY_VALUE in cdn_signing_env")
    pad = "=" * (-len(key_value) % 4)
    decoded = base64.urlsafe_b64decode((key_value + pad).encode("ascii"))
    expires = int(time.time()) + max(60, min(86400, ttl_sec))
    policy = f"URLPrefix={url}&Expires={expires}&KeyName={key_name}"
    digest = hmac.new(decoded, policy.encode("utf-8"), hashlib.sha1).digest()
    signature = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    sep = "&" if "?" in url else "?"
    encoded_prefix = quote(url, safe="")
    return f"{url}{sep}URLPrefix={encoded_prefix}&Expires={expires}&KeyName={quote(key_name)}&Signature={signature}"


def _cloudflare_url(
    url: str,
    cred: dict[str, str],
    *,
    origin_presign_url: str | None,
    ttl_sec: int,
) -> str:
    token = cred.get("token") or ""
    if origin_presign_url and token:
        parsed = urlparse(origin_presign_url)
        cdn = urlparse(url)
        rebuilt = urlunparse((cdn.scheme, cdn.netloc, cdn.path, "", parsed.query, ""))
        if token:
            sep = "&" if "?" in rebuilt else "?"
            return f"{rebuilt}{sep}token={quote(token)}"
        return rebuilt
    if token:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}token={quote(token)}"
    return url


def delivery_url(
    locator: StorageLocator,
    domain_config: dict[str, Any],
    *,
    ttl_sec: int = 3600,
    origin_presign_url: str | None = None,
) -> str | None:
    """Return a CDN URL for browser delivery, or fall back to origin presign."""
    provider = str(domain_config.get("cdn_provider") or "none").strip().lower()
    cdn_base = str(domain_config.get("cdn_base_url") or "").strip()
    if provider == "none" or not cdn_base:
        return origin_presign_url

    if provider not in CDN_PROVIDERS:
        provider = "generic"

    signing_env = str(domain_config.get("cdn_signing_env") or domain_config.get("credentials_env") or "").strip()
    cred = _cdn_signing(signing_env)
    object_url = _object_path_url(cdn_base, locator.key)

    if provider == "generic":
        return object_url

    if provider == "cloudfront":
        return _cloudfront_signed(object_url, cred, ttl_sec)

    if provider == "gcs":
        return _gcs_cdn_signed(object_url, cred, ttl_sec)

    if provider == "cloudflare":
        return _cloudflare_url(object_url, cred, origin_presign_url=origin_presign_url, ttl_sec=ttl_sec)

    return object_url
