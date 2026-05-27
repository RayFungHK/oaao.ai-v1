from __future__ import annotations

from typing import Any

from oaao_orchestrator.object_storage.local_store import LocalStore
from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import build_store


def purge_locator(locator: StorageLocator, *, domain: str, domain_config: dict[str, Any]) -> None:
    if locator.backend == "local":
        LocalStore(domain, locator.local_root).delete(locator)
        return
    build_store(locator.backend, domain, domain_config).delete(locator)


def purge_from_item(item: dict[str, Any], *, domain: str, domain_config: dict[str, Any]) -> bool:
    raw = item.get("src_locator")
    if not isinstance(raw, dict):
        return False
    loc = parse_locator(raw)
    if loc is None:
        return False
    purge_locator(loc, domain=domain, domain_config=domain_config)
    return True
