"""Minimal Lance HTTP adapter — POST /v1/task for oaao {@code mm_lance} python_module."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

app = FastAPI(title="oaao Lance adapter", version="0.1.0")

SUPPORTED_TASKS = frozenset(
    {
        "t2i",
        "t2v",
        "x2t_image",
        "x2t_video",
        "image_edit",
        "video_edit",
    }
)

# 1×1 PNG (red) — enough for chat artifact / preview smoke tests in stub mode.
_STUB_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _env(name: str, default: str = "") -> str:
    raw = os.environ.get(name)
    return raw.strip() if isinstance(raw, str) and raw.strip() else default


class TaskRequest(BaseModel):
    task: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)


def _prompt_from_inputs(inputs: dict[str, Any]) -> str:
    for key in ("prompt", "text", "instruction", "caption"):
        raw = inputs.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return ""


def _stub_understand(task: str, inputs: dict[str, Any]) -> dict[str, Any]:
    prompt = _prompt_from_inputs(inputs)
    has_image = bool(str(inputs.get("image_url") or "").strip() or str(inputs.get("path") or "").strip())
    bits = [f"Lance stub ({task}): image={'yes' if has_image else 'no'}"]
    if prompt:
        bits.append(f"prompt={prompt[:400]}")
    return {
        "ok": True,
        "task": task,
        "text": ". ".join(bits),
        "backend": "python_module",
        "python_module": "mm_lance",
        "adapter_mode": "stub",
    }


def _stub_generate(task: str, inputs: dict[str, Any]) -> dict[str, Any]:
    prompt = _prompt_from_inputs(inputs) or "(no prompt)"
    return {
        "ok": True,
        "task": task,
        "text": f"Lance stub ({task}): {prompt[:400]}",
        "image_url": _STUB_PNG_DATA_URL,
        "backend": "python_module",
        "python_module": "mm_lance",
        "adapter_mode": "stub",
        "queue_hint": "heavy_gpu",
    }


def _stub_edit(task: str, inputs: dict[str, Any]) -> dict[str, Any]:
    prompt = _prompt_from_inputs(inputs) or "(no edit instruction)"
    has_image = bool(str(inputs.get("image_url") or "").strip() or str(inputs.get("path") or "").strip())
    return {
        "ok": True,
        "task": task,
        "text": f"Lance stub ({task}): {prompt[:400]}",
        "image_url": _STUB_PNG_DATA_URL if has_image else "",
        "backend": "python_module",
        "python_module": "mm_lance",
        "adapter_mode": "stub",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "mode": _env("LANCE_ADAPTER_MODE", "stub"),
        "dev_backend": _env("LANCE_DEV_BACKEND", "stub"),
        "service": "lance",
    }


@app.post("/v1/task")
async def run_task(body: TaskRequest) -> dict[str, Any]:
    task = (body.task or "").strip()
    inputs = dict(body.inputs or {})
    if task not in SUPPORTED_TASKS:
        return {
            "ok": False,
            "error": f"unsupported_lance_task:{task or 'empty'}",
            "supported_tasks": sorted(SUPPORTED_TASKS),
        }

    mode = _env("LANCE_ADAPTER_MODE", "stub").lower()
    if mode == "pipeline":
        # Reserved for a future GPU / Hugging Face Lance worker integration.
        logger.warning("LANCE_ADAPTER_MODE=pipeline not implemented — falling back to stub task=%s", task)
        mode = "stub"

    if task in {"x2t_image", "x2t_video"}:
        return _stub_understand(task, inputs)
    if task in {"t2i", "t2v"}:
        return _stub_generate(task, inputs)
    return _stub_edit(task, inputs)
