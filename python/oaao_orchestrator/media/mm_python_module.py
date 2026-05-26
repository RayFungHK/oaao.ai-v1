"""Pluggable Python multimodal providers ({@code python_module} in mm.* purpose bindings)."""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

_MM_MODULES: dict[str, MmPythonModule] = {}
_MM_ALIASES: dict[str, str] = {}


@runtime_checkable
class MmPythonModule(Protocol):
    module_id: str
    supported_tasks: frozenset[str]

    async def run(self, task: str, inputs: dict[str, Any], binding: dict[str, Any]) -> dict[str, Any]: ...


def normalize_module_id(raw: str) -> str:
    mid = (raw or "").strip().lower()
    if not mid:
        return "mm_lance"
    if mid in _MM_MODULES:
        return mid
    return _MM_ALIASES.get(mid, mid)


def register(module: MmPythonModule, *, aliases: list[str] | None = None) -> None:
    mid = normalize_module_id(getattr(module, "module_id", ""))
    if not mid:
        raise ValueError("MmPythonModule.module_id is required")
    _MM_MODULES[mid] = module
    for alias in aliases or []:
        a = (alias or "").strip().lower()
        if a and a != mid:
            _MM_ALIASES[a] = mid
    logger.debug("MmPythonModuleRegister: registered %s aliases=%s", mid, aliases or [])


def get(module_id: str) -> MmPythonModule | None:
    mid = normalize_module_id(module_id)
    return _MM_MODULES.get(mid)


def all_module_ids() -> list[str]:
    return sorted(_MM_MODULES.keys())


async def run_module(
    module_id: str,
    *,
    task: str,
    inputs: dict[str, Any],
    binding: dict[str, Any],
) -> dict[str, Any]:
    mid = normalize_module_id(module_id)
    mod = _MM_MODULES.get(mid)
    if mod is None:
        return {
            "ok": False,
            "error": f"unknown_python_module:{mid}",
            "backend": "python_module",
            "python_module": mid,
        }
    task = (task or "").strip()
    if task and task not in mod.supported_tasks:
        return {
            "ok": False,
            "error": f"unsupported_task:{task}",
            "backend": "python_module",
            "python_module": mid,
            "supported_tasks": sorted(mod.supported_tasks),
        }
    try:
        out = await mod.run(task, dict(inputs or {}), dict(binding or {}))
    except Exception as exc:  # noqa: BLE001
        logger.exception("mm python module run failed module=%s task=%s", mid, task)
        return {
            "ok": False,
            "error": "module_run_failed",
            "backend": "python_module",
            "python_module": mid,
            "detail": str(exc),
        }
    if not isinstance(out, dict):
        return {
            "ok": False,
            "error": "module_invalid_response",
            "backend": "python_module",
            "python_module": mid,
        }
    out.setdefault("ok", True)
    out.setdefault("backend", "python_module")
    out.setdefault("python_module", mid)
    out.setdefault("task", task)
    return out
