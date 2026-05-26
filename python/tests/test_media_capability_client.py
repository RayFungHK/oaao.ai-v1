"""Tests for MediaCapabilityClient."""

import pytest

from oaao_orchestrator.media.capability_client import MediaCapabilityClient


@pytest.mark.asyncio
async def test_endpoint_stub_requires_base_url():
    client = MediaCapabilityClient()
    out = await client.run({"backend": "endpoint", "protocol": "openai_chat"})
    assert out["ok"] is False
    assert out["error"] == "endpoint_binding_incomplete"


@pytest.mark.asyncio
async def test_endpoint_vision_requires_image_url():
    client = MediaCapabilityClient()
    out = await client.run(
        {
            "backend": "endpoint",
            "protocol": "openai_chat",
            "base_url": "http://localhost:8000/v1",
            "model": "gpt-4o",
            "mm_axis": "understand",
            "default_task": "x2t_image",
        },
        inputs={},
    )
    assert out["ok"] is False
    assert out["error"] == "missing_image_url"


@pytest.mark.asyncio
async def test_endpoint_vision_caption(monkeypatch):
    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "A blue diagram."}}]}

    class FakeClient:
        async def post(self, *args, **kwargs):
            return FakeResp()

        async def aclose(self):
            return None

    client = MediaCapabilityClient()
    out = await client.run(
        {
            "backend": "endpoint",
            "protocol": "openai_chat",
            "base_url": "http://localhost:8000/v1",
            "model": "gpt-4o",
            "mm_axis": "understand",
            "default_task": "x2t_image",
        },
        inputs={"image_url": "data:image/png;base64,abc", "http_client": FakeClient()},
    )
    assert out["ok"] is True
    assert out["text"] == "A blue diagram."


@pytest.mark.asyncio
async def test_endpoint_generate_not_supported_on_openai_chat():
    client = MediaCapabilityClient()
    out = await client.run(
        {
            "backend": "endpoint",
            "protocol": "openai_chat",
            "base_url": "http://localhost:8000/v1",
            "model": "gpt-4o",
            "mm_axis": "generate",
            "default_task": "t2i",
        },
        inputs={"prompt": "a cat"},
    )
    assert out["ok"] is False
    assert "endpoint_task_not_supported" in out["error"]


@pytest.mark.asyncio
async def test_lance_python_module_stub():
    client = MediaCapabilityClient()
    out = await client.run(
        {
            "backend": "python_module",
            "python_module": "mm_lance",
            "mm_axis": "generate",
            "default_task": "t2i",
        },
        task="t2i",
        inputs={"prompt": "a cat"},
    )
    assert out["ok"] is True
    assert out["python_module"] == "mm_lance"
    assert out["queue_hint"] == "heavy_gpu"
