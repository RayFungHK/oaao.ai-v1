"""Lance multimodal adapter — canonical module id {@code mm_lance}."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.media.lance_client import lance_base_url, run_lance_task

logger = logging.getLogger(__name__)

LANCE_TASKS = frozenset(
    {
        "t2i",
        "t2v",
        "x2t_image",
        "x2t_video",
        "image_edit",
        "video_edit",
    }
)


class LanceMmAdapter:
    module_id = "mm_lance"
    supported_tasks = LANCE_TASKS

    async def run(self, task: str, inputs: dict[str, Any], binding: dict[str, Any]) -> dict[str, Any]:
        task = (task or binding.get("default_task") or "").strip()
        if task not in self.supported_tasks:
            return {
                "ok": False,
                "error": f"unsupported_lance_task:{task}",
                "python_module": self.module_id,
            }

        base_url = ""
        module_cfg = binding.get("module_config")
        if isinstance(module_cfg, dict):
            base_url = str(module_cfg.get("base_url") or "").strip()
            env_key = str(module_cfg.get("base_url_env") or "").strip()
            if not base_url and env_key:
                env_val = os.environ.get(env_key)
                if isinstance(env_val, str) and env_val.strip():
                    base_url = env_val.strip().rstrip("/")
        if not base_url:
            base_url = lance_base_url()

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as http:
            remote = await run_lance_task(http, task=task, inputs=inputs, base_url=base_url or None)
        if isinstance(remote, dict):
            remote.setdefault("python_module", self.module_id)
            return remote

        logger.info(
            "LanceMmAdapter deferred (no base URL) task=%s axis=%s",
            task,
            binding.get("mm_axis"),
        )
        return {
            "ok": True,
            "python_module": self.module_id,
            "task": task,
            "mm_axis": binding.get("mm_axis"),
            "deferred": True,
            "queue_hint": "heavy_gpu",
            "inputs_keys": sorted(inputs.keys()),
        }
