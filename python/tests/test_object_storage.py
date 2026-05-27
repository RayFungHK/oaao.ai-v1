from __future__ import annotations

import json
import tempfile
from pathlib import Path

from oaao_orchestrator.object_storage.local_store import LocalStore
from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import materialize_locator


def test_parse_locator_roundtrip() -> None:
    raw = {"backend": "s3", "key": "tenant/vault/1/doc.pdf", "bucket": "b", "size": 12}
    loc = parse_locator(raw)
    assert loc is not None
    assert loc.backend == "s3"
    assert loc.key.endswith("doc.pdf")
    again = parse_locator(loc.to_dict())
    assert again == loc


def test_local_store_put_get() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        store = LocalStore("vault", tmp)
        loc = StorageLocator(backend="local", key="1/2.txt", local_root=tmp)
        out = store.put_bytes(loc, b"hello")
        assert out.size == 5
        assert store.get_bytes(out) == b"hello"
        assert store.exists(out)


def test_materialize_local_is_absolute() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        store = LocalStore("vault", tmp)
        loc = store.put_bytes(StorageLocator(backend="local", key="a.bin", local_root=tmp), b"x")
        path = materialize_locator(loc, tenant_id=1, domain="vault", domain_config={})
        assert Path(path).is_file()


def test_cdn_generic_delivery_url() -> None:
    from oaao_orchestrator.object_storage.cdn_delivery import delivery_url

    loc = StorageLocator(backend="s3", key="tenant/vault/1/doc.pdf", bucket="b")
    url = delivery_url(
        loc,
        {"cdn_provider": "generic", "cdn_base_url": "https://cdn.example.com"},
        ttl_sec=3600,
        origin_presign_url="https://bucket.s3.amazonaws.com/x?sig=1",
    )
    assert url == "https://cdn.example.com/tenant/vault/1/doc.pdf"


def test_migrate_purge_local(tmp_path) -> None:
    from oaao_orchestrator.object_storage.migrate import migrate_one_object

    store = LocalStore("vault", str(tmp_path))
    src = store.put_bytes(StorageLocator(backend="local", key="a.txt", local_root=str(tmp_path)), b"payload")
    item = {"object_id": "vault_doc:1", "src_locator": src.to_dict()}
    dst_cfg = {"backend": "local", "bucket": "", "region": ""}
    result = migrate_one_object(
        tenant_id=1,
        domain="vault",
        item=item,
        src_domain_config={"backend": "local"},
        dst_domain_config=dst_cfg,
        purge_source=True,
    )
    assert result["ok"] is True
    assert result.get("source_purged") is True
    assert not (tmp_path / "a.txt").is_file()


def test_locator_rejects_traversal() -> None:
    assert parse_locator({"backend": "local", "key": "../etc/passwd"}) is None


def test_inline_credentials_precedence(monkeypatch) -> None:
    from oaao_orchestrator.object_storage.config import resolve_credentials_from_domain_config

    monkeypatch.setenv("OAAO_S3_MAIN_ACCESS_KEY", "env-key")
    cfg = {
        "credentials_env": "OAAO_S3_MAIN",
        "credentials": {"access_key": "inline-key", "secret_key": "inline-secret"},
    }
    cred = resolve_credentials_from_domain_config(cfg)
    assert cred.get("access_key") == "inline-key"
    assert cred.get("secret_key") == "inline-secret"
