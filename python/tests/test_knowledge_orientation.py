"""WS-1-S2 — tenant / platform orientation store."""

from __future__ import annotations

import json
import tempfile

import pytest

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.orientation_store import (
    load_effective_orientation,
    load_orientation_tenant,
    merge_orientation_layers,
    save_orientation,
)
from oaao_orchestrator.knowledge.scope import KnowledgeScopeRef


@pytest.fixture
def orientation_dir(monkeypatch: pytest.MonkeyPatch) -> str:
    tmp = tempfile.mkdtemp()
    monkeypatch.setenv("OAAO_KNOWLEDGE_ORIENTATION_STORE_DIR", tmp)
    return tmp


def test_tenant_orientation_roundtrip(orientation_dir: str) -> None:
    row = OrientationJsonV1(
        scope="tenant",
        tenant_id=42,
        workspace_id=7,
        topics=["compliance"],
        entities=["HKGX"],
        summary="Tenant-wide exchange compliance focus",
    )
    save_orientation(row)
    loaded = load_orientation_tenant(42)
    assert loaded is not None
    assert loaded.topics == ["compliance"]
    assert loaded.workspace_id == 7


def test_effective_merges_platform_and_tenant(orientation_dir: str) -> None:
    save_orientation(
        OrientationJsonV1(
            scope="platform",
            topics=["platform-wide AI"],
            summary="Platform baseline",
        )
    )
    save_orientation(
        OrientationJsonV1(
            scope="tenant",
            tenant_id=9,
            topics=["tenant HKGX"],
            summary="Tenant overlay",
        )
    )
    effective = load_effective_orientation(tenant_id=9)
    assert effective is not None
    assert "platform-wide AI" in effective.topics
    assert "tenant HKGX" in effective.topics
    merged = merge_orientation_layers(
        load_effective_orientation(tenant_id=None),
        load_orientation_tenant(9),
    )
    assert merged is not None
    assert merged.tenant_id == 9
