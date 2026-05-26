"""OpenAI-compatible vision helpers for mm.understand endpoint bindings."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.endpoint_keys import resolve_api_key_env_dict

logger = logging.getLogger(__name__)


def text_from_openai_payload(payload: dict[str, Any]) -> str:
    for key in ("text", "caption", "output", "content"):
        raw = payload.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
    return ""


def chat_completions_url(base_url: str) -> str:
    bu = str(base_url or "").strip().rstrip("/")
    if not bu:
        return ""
    return bu if bu.endswith("/chat/completions") else f"{bu}/chat/completions"


async def openai_vision_caption(
    client: httpx.AsyncClient,
    *,
    binding: dict[str, Any],
    image_url: str,
    prompt: str = "Describe this image for a chat assistant. Be factual and concise.",
    max_tokens: int = 1200,
) -> str:
    base_url = str(binding.get("base_url") or "").strip()
    model = str(binding.get("model") or "").strip()
    if not base_url or not model or not image_url:
        return ""
    api_key = resolve_api_key_env_dict(binding)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        "max_tokens": max_tokens,
    }
    comp_url = chat_completions_url(base_url)
    try:
        r = await client.post(comp_url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=10.0))
        if r.status_code >= 400:
            logger.warning("openai_vision HTTP %s model=%s", r.status_code, model)
            return ""
        payload = r.json()
        if isinstance(payload, dict):
            text = text_from_openai_payload(payload)
            return text[:24000] if text else ""
    except httpx.RequestError as exc:
        logger.warning("openai_vision request failed model=%s: %s", model, exc)
    return ""
