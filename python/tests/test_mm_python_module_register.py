"""Tests for MmPythonModuleRegister and Lance adapter."""

from __future__ import annotations

import asyncio

from oaao_orchestrator.media.adapters.lance import LanceMmAdapter
from oaao_orchestrator.media.bootstrap import ensure_mm_python_modules_registered
from oaao_orchestrator.media.capability_client import MediaCapabilityClient
from oaao_orchestrator.media.mm_python_module import get, normalize_module_id, register


def test_normalize_module_id_alias():
    ensure_mm_python_modules_registered()
    assert normalize_module_id("lance") == "mm_lance"
    assert normalize_module_id("mm_lance") == "mm_lance"


def test_registry_resolves_mm_lance():
    ensure_mm_python_modules_registered()
    mod = get("mm_lance")
    assert mod is not None
    assert mod.module_id == "mm_lance"
    assert "t2i" in mod.supported_tasks


async def _run_mm_lance_deferred():
    ensure_mm_python_modules_registered()
    client = MediaCapabilityClient()
    return await client.run(
        {
            "backend": "python_module",
            "python_module": "mm_lance",
            "mm_axis": "generate",
            "default_task": "t2i",
        },
        task="t2i",
        inputs={"prompt": "a cat"},
    )


def test_mm_lance_deferred_without_url():
    out = asyncio.run(_run_mm_lance_deferred())
    assert out["ok"] is True
    assert out["python_module"] == "mm_lance"
    assert out.get("queue_hint") == "heavy_gpu"


async def _run_mm_lance_with_module_config_url():
    ensure_mm_python_modules_registered()
    client = MediaCapabilityClient()
    return await client.run(
        {
            "backend": "python_module",
            "python_module": "mm_lance",
            "mm_axis": "understand",
            "default_task": "x2t_image",
            "module_config": {
                "base_url": "http://127.0.0.1:59999",
                "base_url_env": "OAAO_LANCE_BASE_URL",
            },
        },
        task="x2t_image",
        inputs={"path": "/nonexistent.jpg"},
    )


def test_mm_lance_uses_module_config_base_url(monkeypatch):
    """Settings-persisted base_url is passed via module_config (no env restart)."""
    monkeypatch.delenv("OAAO_LANCE_BASE_URL", raising=False)
    out = asyncio.run(_run_mm_lance_with_module_config_url())
    assert out["python_module"] == "mm_lance"
    assert out.get("error") in ("lance_unreachable", "lance_http_404", "lance_http_502", "lance_http_503")


def test_legacy_lance_alias_routes_to_mm_lance():
    out = asyncio.run(
        MediaCapabilityClient().run(
            {"backend": "python_module", "python_module": "lance", "default_task": "t2i"},
            task="t2i",
            inputs={},
        )
    )
    assert out["python_module"] == "mm_lance"


class _StubModule:
    module_id = "mm_stub"
    supported_tasks = frozenset({"echo"})

    async def run(self, task: str, inputs: dict, binding: dict) -> dict:
        return {"ok": True, "text": str(inputs.get("x", "")), "python_module": self.module_id}


def test_custom_module_register():
    register(_StubModule(), aliases=[])
    mod = get("mm_stub")
    assert mod is not None
