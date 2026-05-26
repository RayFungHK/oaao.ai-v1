"""Vault RAG embedding + URL helpers (W7-S2 phase 1)."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)
def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _hostport_looks_http_default(hostport: str) -> bool:
    """Bare URL hostport without scheme: assume http on loopback / LAN-style hosts, https otherwise (matches orchestrator ingress)."""
    h = hostport.strip().lower()
    if "@" in h:
        h = h.split("@")[-1]
    host = h.split(":", 1)[0].strip("[]")
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"):
        return True
    if host.endswith(".local"):
        return True
    return bool(re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", host))


def ensure_url_scheme(base_url: str) -> str:
    """Prefix ``http(s)://`` when admins paste bare ``host/name`` (httpx requirement)."""
    bu = base_url.strip()
    if not bu:
        return bu
    low = bu.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return bu
    hostport = bu.split("/", 1)[0]
    prefix = "http://" if _hostport_looks_http_default(hostport) else "https://"
    return f"{prefix}{bu}"


def openai_compat_embeddings_url_from_base(endpoint_base_url: str) -> str:
    """
    Resolve OpenAI-compat ``…/embeddings`` from canonical ``oaao_endpoint.base_url`` (parity with chat ``…/chat/completions`` rules).
    """
    bu = ensure_url_scheme(endpoint_base_url).rstrip("/")
    if bu.lower().endswith("/v1"):
        return f"{bu}/embeddings"
    return f"{bu}/v1/embeddings"


def _embedding_native_ollama_request(url: str) -> bool:
    """Native Ollama uses POST /api/embeddings + {\"prompt\": ...}; OpenAI-compat is /v1/embeddings + {\"input\": ...}."""
    if _env("OAAO_EMBEDDING_NATIVE_OLLAMA", "") in ("1", "true", "yes"):
        return True
    path = urlparse(url).path.rstrip("/")
    return path.endswith("/api/embeddings") and "/v1" not in path


def _extract_embedding_vector(data: Any) -> list[Any] | None:
    """OpenAI-style {\"data\":[{\"embedding\":[...]}]} or native Ollama {\"embedding\":[...]}."""
    if not isinstance(data, dict):
        return None
    emb = data.get("embedding")
    if isinstance(emb, list) and emb:
        return emb
    inner = data.get("data")
    if isinstance(inner, list) and inner:
        first = inner[0]
        if isinstance(first, dict):
            e2 = first.get("embedding")
            if isinstance(e2, list) and e2:
                return e2
    return None


def _embedding_batch_vectors_from_json(data: Any, *, expected: int) -> list[list[float]] | None:
    """Parse OpenAI-compat batch ``{\"data\":[{\"index\",\"embedding\"},…]}`` (``index`` optional, server order fallback)."""
    if not isinstance(data, dict):
        return None
    inner = data.get("data")
    if not isinstance(inner, list) or len(inner) != expected:
        return None
    typed: list[tuple[int, list[float]]] = []
    for i, item in enumerate(inner):
        if not isinstance(item, dict):
            return None
        emb = item.get("embedding")
        if not isinstance(emb, list) or not emb:
            return None
        try:
            vec = [float(x) for x in emb]
        except (TypeError, ValueError):
            return None
        ix = item.get("index")
        typed.append((ix if isinstance(ix, int) else i, vec))
    typed.sort(key=lambda x: x[0])
    return [t[1] for t in typed]


async def openai_compat_embed_batch(
    client: httpx.AsyncClient,
    texts: list[str],
    api_key: str | None,
    *,
    url: str,
    model: str,
    request_timeout: httpx.Timeout | None = None,
) -> tuple[list[list[float]] | None, str | None]:
    """
    Embed many strings in minimal round-trips — OpenAI-compat ``input`` array when not native-Ollama; else parallel ``/api/embed``.
    Used by vault ingest where sequential per-chunk calls dominated latency.
    """
    n = len(texts)
    if n == 0:
        return [], None

    clipped: list[str] = []
    for raw in texts:
        c = (raw or "")[:12000]
        if not c.strip():
            return None, "embedding_empty_input"
        clipped.append(c)

    model_use = (model or "").strip()
    url_use = (url or "").strip()
    if not model_use:
        return None, "embedding_model_unconfigured"
    if not url_use:
        return None, "embedding_url_unconfigured"

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    native = _embedding_native_ollama_request(url_use)
    timeout = request_timeout or httpx.Timeout(240.0, connect=25.0)

    if native:
        concurrency = max(1, min(48, int(_env("OAAO_VAULT_EMBED_CONCURRENCY", "12") or "12")))
        sem = asyncio.Semaphore(concurrency)

        async def embed_one(p: str) -> list[float]:
            async with sem:
                body: dict[str, Any] = {"model": model_use, "prompt": p}
                r = await client.post(url_use, headers=headers, json=body, timeout=timeout)
                if r.status_code >= 400:
                    preview = (r.text or "").replace("\n", " ").strip()[:380]
                    raise RuntimeError(f"embedding_http_{r.status_code}:{preview}")
                payload = r.json()
                raw_e = _extract_embedding_vector(payload)
                if not isinstance(raw_e, list) or not raw_e:
                    raise RuntimeError("embedding_empty_response")
                try:
                    return [float(x) for x in raw_e]
                except (TypeError, ValueError) as e:
                    raise RuntimeError("embedding_non_numeric_vector") from e

        results = await asyncio.gather(*[embed_one(p) for p in clipped], return_exceptions=True)
        out_vectors: list[list[float]] = []
        for ri, res in enumerate(results):
            if isinstance(res, BaseException):
                detail = str(res).replace("\n", " ").strip()[:420]
                return None, f"embedding_failed_parallel:{ri}:{detail}"
            out_vectors.append(res)
        return out_vectors, None

    body_arr: dict[str, Any] = {"model": model_use, "input": clipped}

    try:
        r = await client.post(url_use, headers=headers, json=body_arr, timeout=timeout)
    except httpx.TimeoutException as e:
        logger.warning("embedding batch timeout — %s", e)
        return None, f"embedding_timeout:{e}"
    except httpx.RequestError as e:
        logger.warning("embedding batch request error — %s", e)
        return None, f"embedding_request_error:{e}"

    if r.status_code >= 400:
        preview = (r.text or "").replace("\n", " ").strip()[:420]
        logger.warning("embedding batch HTTP %s — %s", r.status_code, preview)
        return None, f"embedding_http_{r.status_code}:{preview}"

    try:
        payload = r.json()
    except Exception:  # noqa: BLE001
        return None, "embedding_invalid_json_response"

    vectors = _embedding_batch_vectors_from_json(payload, expected=n)
    if vectors is None:
        return None, "embedding_batch_parse_failed"
    return vectors, None


async def _openai_embed(
    text: str,
    api_key: str | None,
    *,
    url: str | None = None,
    model: str | None = None,
) -> tuple[list[float] | None, str | None]:
    """
    POST to an OpenAI-compatible embedding endpoint (or native Ollama when URL path is ``/api/embeddings``).

    Returns ``(vector, None)`` on success; on failure ``(None, short_reason)`` for surfacing to vault_job_finish / logs.
    """
    model_use = (model or "").strip()
    url_use = (url or "").strip()
    if not model_use:
        return None, "embedding_model_unconfigured"
    if not url_use:
        return None, "embedding_url_unconfigured"
    clip = (text or "")[:12000]
    if not clip.strip():
        return None, "embedding_empty_input"

    async with httpx.AsyncClient() as client:
        vecs, err = await openai_compat_embed_batch(
            client,
            [clip],
            api_key,
            url=url_use,
            model=model_use,
            request_timeout=httpx.Timeout(45.0, connect=12.0),
        )
    if err or not vecs or len(vecs) != 1:
        return None, err or "embedding_empty_response"
    return vecs[0], None
