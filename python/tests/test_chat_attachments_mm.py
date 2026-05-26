"""Tests for mm.understand attachment caption path."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from oaao_orchestrator.chat_attachments import (
    _is_mm_stub_caption,
    _vision_endpoint,
    process_chat_attachments,
)


def test_vision_endpoint_prefers_mm_binding():
    chat = {"model": "gpt-4o-mini", "base_url": "http://chat/v1"}
    mm = {
        "backend": "endpoint",
        "base_url": "http://mm/v1",
        "model": "gpt-4o",
        "api_key_env": "OPENAI_API_KEY",
    }
    out = _vision_endpoint(chat, mm)
    assert out["model"] == "gpt-4o"
    assert out["base_url"] == "http://mm/v1"


@pytest.mark.asyncio
async def test_process_attachments_mm_python_module_caption(tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 64)
    messages = [{"role": "user", "content": "summarize"}]
    attachments = [
        {
            "id": 1,
            "file_name": "a.png",
            "mime_type": "image/png",
            "absolute_path": str(img),
        }
    ]
    mm = {
        "purpose_key": "mm.understand.primary",
        "backend": "python_module",
        "python_module": "lance",
        "default_task": "x2t_image",
    }
    client = AsyncMock()
    with patch(
        "oaao_orchestrator.chat_attachments._caption_image_via_mm",
        new=AsyncMock(return_value="A contract fee table with three tiers."),
    ):
        out_msgs, pipeline = await process_chat_attachments(
            client,
            messages,
            attachments,
            endpoint={"model": "gpt-4o-mini", "base_url": "http://chat/v1"},
            mm_understand=mm,
        )
    assert any("mm.understand" in str(m.get("content", "")) for m in out_msgs if m.get("role") == "system")
    blocks = pipeline.get("blocks") or []
    assert any(b.get("type") == "attachment_citations" for b in blocks)


def test_is_mm_stub_caption_detects_lance_dev_adapter():
    assert _is_mm_stub_caption(
        {"adapter_mode": "stub", "text": "Lance stub (x2t_image): image=yes"},
        "Lance stub (x2t_image): image=yes",
    )
    assert not _is_mm_stub_caption(
        {"adapter_mode": "pipeline", "text": "A dove illustration with 咕咕 text."},
        "A dove illustration with 咕咕 text.",
    )
