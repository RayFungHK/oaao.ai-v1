"""Multimodal capability client — endpoint (OpenAI-compat) or registered python_module adapters."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.media.bootstrap import ensure_mm_python_modules_registered
from oaao_orchestrator.media.mm_python_module import normalize_module_id, run_module
from oaao_orchestrator.media.openai_vision import openai_vision_caption, text_from_openai_payload

logger = logging.getLogger(__name__)

_UNDERSTAND_TASKS = frozenset({"x2t_image", "x2t_video", "caption", "describe"})
_EDIT_TASKS = frozenset({"image_edit", "video_edit", "inpaint"})


class MediaCapabilityClient:
    """Resolve Settings Purpose binding into understand / generate / edit calls."""

    def __init__(self) -> None:
        ensure_mm_python_modules_registered()

    async def run(
        self,
        binding: dict[str, Any],
        *,
        task: str | None = None,
        inputs: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        inputs = dict(inputs or {})
        task = (task or binding.get("default_task") or "").strip()
        backend = str(binding.get("backend") or "endpoint").strip().lower()
        if backend == "python_module":
            module_id = normalize_module_id(str(binding.get("python_module") or "mm_lance"))
            binding = {**binding, "python_module": module_id}
            return await self._run_python_module(binding, task=task, inputs=inputs)
        return await self._run_endpoint(binding, task=task, inputs=inputs)

    async def _run_endpoint(
        self,
        binding: dict[str, Any],
        *,
        task: str,
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        protocol = str(binding.get("protocol") or "openai_chat").strip().lower()
        if protocol != "openai_chat":
            return {
                "ok": False,
                "error": f"unsupported_endpoint_protocol:{protocol}",
                "backend": "endpoint",
            }
        base_url = str(binding.get("base_url") or "").strip()
        model = str(binding.get("model") or "").strip()
        if not base_url or not model:
            return {"ok": False, "error": "endpoint_binding_incomplete", "backend": "endpoint"}

        if task in _UNDERSTAND_TASKS or task in _EDIT_TASKS:
            image_url = str(inputs.get("image_url") or "").strip()
            if not image_url:
                return {"ok": False, "error": "missing_image_url", "backend": "endpoint", "task": task}
            prompt = str(
                inputs.get("prompt")
                or inputs.get("instruction")
                or (
                    "Describe this image for a chat assistant. Be factual and concise."
                    if task in _UNDERSTAND_TASKS
                    else "Apply the edit instruction to this image and describe the result."
                )
            ).strip()
            client = inputs.get("http_client")
            owns_client = client is None
            if owns_client:
                client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
            try:
                text = await openai_vision_caption(
                    client,
                    binding=binding,
                    image_url=image_url,
                    prompt=prompt,
                )
            finally:
                if owns_client and hasattr(client, "aclose"):
                    await client.aclose()
            if not text:
                return {
                    "ok": False,
                    "error": "vision_empty_response",
                    "backend": "endpoint",
                    "task": task,
                    "model": model,
                }
            return {
                "ok": True,
                "backend": "endpoint",
                "protocol": protocol,
                "task": task,
                "mm_axis": binding.get("mm_axis"),
                "text": text,
                "model": model,
            }

        logger.info(
            "MediaCapabilityClient endpoint generate stub task=%s axis=%s model=%s",
            task,
            binding.get("mm_axis"),
            model,
        )
        return {
            "ok": False,
            "error": f"endpoint_task_not_supported:{task}",
            "backend": "endpoint",
            "protocol": protocol,
            "task": task,
            "mm_axis": binding.get("mm_axis"),
            "hint": "Use python_module mm_lance for t2i/t2v generation",
        }

    async def _run_python_module(
        self,
        binding: dict[str, Any],
        *,
        task: str,
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        module_id = normalize_module_id(str(binding.get("python_module") or "mm_lance"))
        clean_inputs = {k: v for k, v in inputs.items() if k != "http_client"}
        result = await run_module(module_id, task=task, inputs=clean_inputs, binding=binding)
        if isinstance(result, dict) and not result.get("text"):
            text = text_from_openai_payload(result)
            if text:
                result = {**result, "text": text}
        return result
