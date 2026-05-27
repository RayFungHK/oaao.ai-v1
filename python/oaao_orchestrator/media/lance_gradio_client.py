"""Gradio Lance worker client — {@code lance.rayfung.hk} exposes {@code /gradio_api/call/run_task}."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# oaao task → Gradio dropdown task (T2V / V2T app — no image→text endpoint yet).
_GRADIO_TASK = {
    "t2v": "t2v",
    "x2t_video": "v2t",
}


async def _gradio_upload(client: httpx.AsyncClient, base: str, local_path: str) -> str | None:
    p = Path(local_path)
    if not p.is_file():
        return None
    try:
        r = await client.post(
            f"{base}/gradio_api/upload",
            files={"files": (p.name, p.read_bytes(), "application/octet-stream")},
            timeout=httpx.Timeout(120.0, connect=15.0),
        )
    except httpx.RequestError as exc:
        logger.warning("gradio upload failed path=%s: %s", local_path, exc)
        return None
    if r.status_code >= 400:
        logger.warning("gradio upload HTTP %s path=%s", r.status_code, local_path)
        return None
    try:
        payload = r.json()
    except ValueError:
        return None
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, str) and first.strip():
            return first.strip()
    return None


async def _gradio_call_run_task(
    client: httpx.AsyncClient,
    base: str,
    data: list[Any],
) -> dict[str, Any] | None:
    try:
        r = await client.post(
            f"{base}/gradio_api/call/run_task",
            json={"data": data},
            timeout=httpx.Timeout(30.0, connect=15.0),
        )
    except httpx.RequestError as exc:
        logger.warning("gradio call/run_task failed: %s", exc)
        return {"ok": False, "error": "gradio_unreachable", "detail": str(exc)}
    if r.status_code >= 400:
        return {"ok": False, "error": f"gradio_http_{r.status_code}", "detail": r.text[:500]}
    try:
        body = r.json()
    except ValueError:
        return {"ok": False, "error": "gradio_non_json"}
    event_id = body.get("event_id") if isinstance(body, dict) else None
    if not isinstance(event_id, str) or not event_id.strip():
        return {"ok": False, "error": "gradio_missing_event_id"}
    try:
        poll = await client.get(
            f"{base}/gradio_api/call/run_task/{event_id}",
            timeout=httpx.Timeout(600.0, connect=15.0),
        )
    except httpx.RequestError as exc:
        return {"ok": False, "error": "gradio_poll_failed", "detail": str(exc)}
    if poll.status_code >= 400:
        return {"ok": False, "error": f"gradio_poll_http_{poll.status_code}", "detail": poll.text[:500]}
    # SSE body: lines like `data: [...]`
    text = poll.text or ""
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        import json

        raw = line[5:].strip()
        if raw == "[DONE]":
            break
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list) and len(parsed) >= 2:
            text_result = parsed[1]
            if isinstance(text_result, str) and text_result.strip():
                return {
                    "ok": True,
                    "text": text_result.strip(),
                    "backend": "python_module",
                    "python_module": "mm_lance",
                    "adapter_mode": "gradio",
                }
    return {"ok": False, "error": "gradio_empty_result"}


async def run_lance_gradio_task(
    client: httpx.AsyncClient,
    *,
    task: str,
    inputs: dict[str, Any],
    base_url: str,
) -> dict[str, Any] | None:
    """Map oaao mm tasks onto Gradio Lance {@code /run_task} when sidecar {@code /v1/task} is absent."""
    gradio_task = _GRADIO_TASK.get((task or "").strip())
    if not gradio_task:
        return None

    base = (base_url or "").strip().rstrip("/")
    if not base:
        return None

    prompt = str(inputs.get("prompt") or inputs.get("text") or inputs.get("instruction") or "").strip()
    question = prompt or "Describe this video."

    input_video: dict[str, Any] | None = None
    if gradio_task == "v2t":
        path = str(inputs.get("path") or "").strip()
        if not path:
            return {"ok": False, "error": "gradio_v2t_missing_path", "task": task}
        uploaded = await _gradio_upload(client, base, path)
        if not uploaded:
            return {"ok": False, "error": "gradio_upload_failed", "task": task}
        input_video = {"video": {"path": uploaded, "meta": {"_type": "gradio.FileData"}}}

    data: list[Any] = [
        gradio_task,
        prompt if gradio_task == "t2v" else "",
        input_video,
        question if gradio_task == "v2t" else "",
        480,
        848,
        50,
        -1,
        "video_480p",
        30,
        3.5,
        4.0,
    ]
    result = await _gradio_call_run_task(client, base, data)
    if isinstance(result, dict):
        result.setdefault("task", task)
        result.setdefault("gradio_task", gradio_task)
    return result
