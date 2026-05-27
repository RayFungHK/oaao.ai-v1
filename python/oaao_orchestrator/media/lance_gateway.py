"""Lance Gateway unified client — six task endpoints on one base URL.

Maps OAAO internal tasks to Lance Gateway REST paths:
  t2i → POST /v1/t2i
  t2v → POST /v1/t2v
  x2t_image → POST /v1/i2t
  x2t_video → POST /v1/v2t
  image_edit → POST /v1/image-edit
  video_edit → POST /v1/video-edit
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GATEWAY_TASK_PATHS: dict[str, str] = {
    "t2i": "/v1/t2i",
    "t2v": "/v1/t2v",
    "x2t_image": "/v1/i2t",
    "x2t_video": "/v1/v2t",
    "image_edit": "/v1/image-edit",
    "video_edit": "/v1/video-edit",
}

RESOLUTION_PRESETS: dict[str, tuple[int, int, str]] = {
    "1k": (1024, 1024, "image_1024res"),
    "2k": (2048, 2048, "image_2048res"),
    "4k": (4096, 4096, "image_4096res"),
    "8k": (8192, 8192, "image_8192res"),
    "768": (768, 768, "image_768res"),
}


def _resolution_from_inputs(inputs: dict[str, Any]) -> tuple[int, int, str]:
    raw = str(inputs.get("resolution") or inputs.get("res") or "1k").strip().lower()
    if raw in RESOLUTION_PRESETS:
        return RESOLUTION_PRESETS[raw]
    if raw.startswith("image_") and raw.endswith("res"):
        return (768, 768, raw)
    return RESOLUTION_PRESETS.get("1k", (1024, 1024, "image_1024res"))


def build_gateway_body(task: str, inputs: dict[str, Any]) -> dict[str, Any]:
    """Translate orchestrator inputs into Lance Gateway JSON body."""
    task = (task or "").strip()
    prompt = str(inputs.get("prompt") or inputs.get("text") or inputs.get("instruction") or "").strip()
    body: dict[str, Any] = {}

    if task in {"t2i", "t2v"}:
        if prompt:
            body["prompt"] = prompt
        h, w, res_key = _resolution_from_inputs(inputs)
        body.setdefault("video_height", int(inputs.get("video_height") or h))
        body.setdefault("video_width", int(inputs.get("video_width") or w))
        body.setdefault("resolution", str(inputs.get("resolution") or res_key))
        for key in (
            "seed",
            "validation_num_timesteps",
            "validation_timestep_shift",
            "cfg_text_scale",
            "text_template",
            "use_kvcache",
            "supir_upscale",
            "supir_scale",
            "supir_model",
            "supir_min_size",
        ):
            if key in inputs and inputs[key] is not None:
                body[key] = inputs[key]
        return body

    if task in {"x2t_image", "x2t_video"}:
        if prompt:
            body["prompt"] = prompt
        for key in ("image_url", "image_path", "path", "video_url", "video_path", "mime_type"):
            val = inputs.get(key)
            if isinstance(val, str) and val.strip():
                body[key if key != "path" else "image_path"] = val.strip()
        return body

    if task in {"image_edit", "video_edit"}:
        if prompt:
            body["prompt"] = prompt
        for key in ("image_url", "image_path", "path", "video_url", "video_path", "mask_url"):
            val = inputs.get(key)
            if isinstance(val, str) and val.strip():
                body[key if key != "path" else "image_path"] = val.strip()
        h, w, res_key = _resolution_from_inputs(inputs)
        body.setdefault("resolution", str(inputs.get("resolution") or res_key))
        body.setdefault("video_height", int(inputs.get("video_height") or h))
        body.setdefault("video_width", int(inputs.get("video_width") or w))
        return body

    return {"prompt": prompt, **{k: v for k, v in inputs.items() if k not in {"http_client"}}}


def normalize_gateway_response(task: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Map Lance Gateway job response to orchestrator mm result shape."""
    out: dict[str, Any] = {
        "ok": True,
        "backend": "lance_gateway",
        "task": task,
        "python_module": "mm_lance",
        "raw": payload,
    }
    output_url = str(payload.get("output_url") or "").strip()
    if output_url:
        out["url"] = output_url
        out["image_url"] = output_url
    artifacts = payload.get("artifacts")
    if isinstance(artifacts, list):
        out["artifacts"] = artifacts
        for row in artifacts:
            if isinstance(row, dict):
                name = str(row.get("name") or "")
                url = str(row.get("url") or "")
                if url and (not output_url or name.startswith("supir_")):
                    out["url"] = url
                    out["image_url"] = url
    for key in ("job_id", "task", "output_dir", "postprocess", "supir_log_url", "log_url"):
        if key in payload:
            out[key] = payload[key]
    text = payload.get("text") or payload.get("caption") or payload.get("answer")
    if isinstance(text, str) and text.strip():
        out["text"] = text.strip()
        out["choices"] = [{"message": {"content": text.strip()}}]
    return out


async def run_lance_gateway_task(
    client: httpx.AsyncClient,
    *,
    task: str,
    inputs: dict[str, Any],
    base_url: str,
) -> dict[str, Any] | None:
    """POST to Lance Gateway unified endpoint for the given task."""
    task = (task or "").strip()
    path = GATEWAY_TASK_PATHS.get(task)
    if not path:
        return {"ok": False, "error": f"unsupported_gateway_task:{task}"}

    base = base_url.strip().rstrip("/")
    url = f"{base}{path}"
    body = build_gateway_body(task, inputs)

    try:
        r = await client.post(url, json=body, timeout=httpx.Timeout(300.0, connect=10.0))
    except httpx.RequestError as exc:
        logger.warning("lance gateway request failed task=%s: %s", task, exc)
        return {"ok": False, "error": "lance_gateway_unreachable", "detail": str(exc)}

    if r.status_code >= 400:
        logger.warning("lance gateway HTTP %s task=%s body=%s", r.status_code, task, r.text[:300])
        return {"ok": False, "error": f"lance_gateway_http_{r.status_code}", "detail": r.text[:500]}

    try:
        payload = r.json()
    except ValueError:
        return {"ok": False, "error": "lance_gateway_non_json"}

    if not isinstance(payload, dict):
        return {"ok": False, "error": "lance_gateway_invalid_payload"}

    return normalize_gateway_response(task, payload)


async def probe_gateway(base_url: str, client: httpx.AsyncClient | None = None) -> bool:
    """Return True when GET /v1/tasks responds (Gateway discovery)."""
    base = base_url.strip().rstrip("/")
    url = f"{base}/v1/tasks"
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0))
    try:
        r = await http.get(url)
        return r.status_code == 200
    except httpx.RequestError:
        return False
    finally:
        if own_client:
            await http.aclose()
