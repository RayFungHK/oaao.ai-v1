"""Page classification — L0 rules, L1 features, L2 LLM."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.asr_common import _resolve_secret, openai_compat_chat_url
from oaao_orchestrator.page_router.features import (
    extract_page_features,
    is_nav_link,
    score_index_vs_article,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "OAAO-PageRouter/1.0"


def classify_page_rules(url: str) -> dict[str, Any] | None:
    """L0 deterministic rules."""
    u = (url or "").strip().lower()
    if not u:
        return None
    if re.search(r"(/feed|/rss|\.xml$|feed\.xml|atom\.xml)", u):
        return {"page_type": "rss", "confidence": 0.95, "method": "rule", "reason": "RSS/feed URL"}
    if "arxiv.org/list/" in u:
        return {"page_type": "index", "confidence": 0.98, "method": "rule", "reason": "arXiv list URL"}
    if re.search(r"arxiv\.org/(abs|pdf)/", u):
        return {
            "page_type": "article",
            "confidence": 0.98,
            "method": "rule",
            "reason": "arXiv /abs/ metadata page (full text resolved from HTML experimental when fetching)",
        }
    return None


def classify_page(html: str, url: str) -> dict[str, Any]:
    """L0 + L1 classification without LLM."""
    ruled = classify_page_rules(url)
    if ruled:
        return ruled
    features = extract_page_features(html, url)
    page_type, confidence, reason = score_index_vs_article(features)
    return {
        "page_type": page_type,
        "confidence": confidence,
        "method": "feature",
        "reason": reason,
        "features": features,
    }


async def classify_page_llm(
    client: httpx.AsyncClient,
    *,
    features: dict[str, Any],
    llm_cfg: dict[str, Any],
) -> dict[str, Any]:
    """L2 LLM classification when features are ambiguous."""
    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        raise ValueError("llm_not_configured")

    api_key = _resolve_secret(llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None)
    url = openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    link_lines = []
    for ln in features.get("links_sample") if isinstance(features.get("links_sample"), list) else []:
        if not isinstance(ln, dict):
            continue
        link_lines.append(f"- {ln.get('anchor', '')} -> {ln.get('url', '')}")
    bundle = {
        "url": features.get("url"),
        "title": features.get("title"),
        "h1": features.get("h1"),
        "meta_description": features.get("meta_description"),
        "og_type": features.get("og_type"),
        "p_word_count": features.get("p_word_count"),
        "link_count": features.get("link_count"),
        "headings": features.get("headings"),
        "links_sample": link_lines[:25],
    }
    system = (
        "Classify a web page as INDEX (list/directory with many article links) or ARTICLE (single article/post). "
        'Reply JSON only: {"page_type":"index"|"article","confidence":0-1,"reason":"..."}'
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(bundle, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "stream": False,
    }
    r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(60.0, connect=15.0))
    if r.status_code >= 400:
        raise RuntimeError(f"llm_http_{r.status_code}")
    data = r.json()
    content = ""
    if isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                content = msg["content"].strip()
    parsed = _parse_json_object(content)
    if not isinstance(parsed, dict):
        raise ValueError("llm_bad_response")
    page_type = str(parsed.get("page_type") or parsed.get("type") or "unknown").lower()
    if page_type not in ("index", "article", "rss"):
        page_type = "unknown"
    return {
        "page_type": page_type,
        "confidence": float(parsed.get("confidence") or 0.7),
        "method": "llm",
        "reason": str(parsed.get("reason") or "LLM classification"),
        "usage": data.get("usage") if isinstance(data.get("usage"), dict) else None,
    }


def filter_article_links(
    links: list[dict[str, Any]],
    *,
    keyword_filter: str = "",
    limit: int = 50,
) -> list[dict[str, str]]:
    """Heuristic link filter — drop nav, optional keyword gate."""
    kw = [k.strip().lower() for k in keyword_filter.split(",") if k.strip()]
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for ln in links:
        if not isinstance(ln, dict):
            continue
        href = str(ln.get("url") or "").strip()
        anchor = str(ln.get("anchor") or ln.get("title") or "").strip()
        if not href or href in seen:
            continue
        if is_nav_link(href, anchor):
            continue
        if kw and not any(k in href.lower() or k in anchor.lower() for k in kw):
            continue
        seen.add(href)
        title = anchor or href.rsplit("/", 1)[-1] or href
        out.append({"url": href, "title": title[:200]})
        if len(out) >= limit:
            break
    return out


async def filter_article_links_llm(
    client: httpx.AsyncClient,
    *,
    page_url: str,
    links: list[dict[str, str]],
    llm_cfg: dict[str, Any],
    limit: int = 40,
) -> list[dict[str, str]]:
    """LLM filter for article-like links on an index page."""
    if not links:
        return []
    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        return filter_article_links([{"url": ln["url"], "anchor": ln.get("title", "")} for ln in links], limit=limit)

    api_key = _resolve_secret(llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None)
    url = openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    sample = links[:60]
    system = (
        "From an index/list page, pick URLs that point to individual articles/posts (not nav, tags, login). "
        f'Reply JSON: {{"items":[{{"url":"...","title":"..."}}]}} — max {limit} items.'
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": json.dumps({"page_url": page_url, "links": sample}, ensure_ascii=False),
            },
        ],
        "temperature": 0.1,
        "stream": False,
    }
    r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(90.0, connect=15.0))
    if r.status_code >= 400:
        return filter_article_links([{"url": ln["url"], "anchor": ln.get("title", "")} for ln in links], limit=limit)
    data = r.json()
    content = ""
    if isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                content = msg["content"].strip()
    parsed = _parse_json_object(content)
    items = parsed.get("items") if isinstance(parsed, dict) and isinstance(parsed.get("items"), list) else []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        u = str(it.get("url") or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        out.append({"url": u, "title": str(it.get("title") or u.rsplit("/", 1)[-1])[:200]})
        if len(out) >= limit:
            break
    return out or filter_article_links([{"url": ln["url"], "anchor": ln.get("title", "")} for ln in links], limit=limit)


def resolve_research_kind(page_type: str) -> str:
    if page_type == "rss":
        return "rss"
    if page_type == "index":
        return "index"
    if page_type == "article":
        return "static"
    return "auto"


def resolve_mine_kind(page_type: str) -> str:
    if page_type == "index":
        return "http_index"
    return "static_url"


def needs_confirmation(confidence: float, page_type: str) -> bool:
    if page_type == "unknown":
        return True
    return confidence < 0.75


def _parse_json_object(text: str) -> Any:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {}
