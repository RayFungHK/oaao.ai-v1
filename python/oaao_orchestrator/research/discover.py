"""Research source discovery preview — classify URLs before creating a watch."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.page_router.classify import (
    classify_page,
    classify_page_llm,
    classify_page_rules,
    filter_article_links,
    filter_article_links_llm,
    needs_confirmation,
    resolve_research_kind,
)
from oaao_orchestrator.research.fetch import _candidates_arxiv_list, _candidates_index_page, _fetch_html

logger = logging.getLogger(__name__)


async def _fetch_page_html(
    client: httpx.AsyncClient,
    url: str,
    *,
    use_playwright: bool = False,
) -> str:
    if use_playwright:
        try:
            from oaao_orchestrator.mine.playwright_fetch import fetch_html_playwright  # noqa: PLC0415

            return await fetch_html_playwright(url, wait_ms=1500)
        except Exception as exc:  # noqa: BLE001
            logger.warning("playwright fetch failed %s: %s", url, exc)
    return await _fetch_html(client, url)


async def discover_research_source(
    client: httpx.AsyncClient,
    *,
    url: str,
    kind: str = "auto",
    llm_cfg: dict[str, Any] | None = None,
    use_llm: bool = True,
    use_playwright: bool = False,
    keyword_filter: str = "",
) -> dict[str, Any]:
    """Preview one research source: page type + item links if index."""
    url = (url or "").strip()
    if not url:
        return {"ok": False, "error": "url_required"}

    ruled = classify_page_rules(url)
    usage: dict[str, Any] | None = None

    if ruled and ruled.get("page_type") == "rss":
        from oaao_orchestrator.research.fetch import _candidates_rss  # noqa: PLC0415

        items_raw = await _candidates_rss(client, url)
        items = [{"url": c.url, "title": c.title or c.url} for c in items_raw[:50]]
        return {
            "ok": True,
            "url": url,
            "page_type": "rss",
            "confidence": ruled["confidence"],
            "method": "rule",
            "reason": ruled["reason"],
            "resolved_kind": "rss",
            "needs_confirmation": False,
            "items": items,
            "item_count": len(items),
            "html_hash": None,
        }

    html = await _fetch_page_html(client, url, use_playwright=use_playwright)
    classification = ruled or classify_page(html, url)

    conf = float(classification.get("confidence") or 0)
    page_type = str(classification.get("page_type") or "unknown")
    method = str(classification.get("method") or "feature")
    reason = str(classification.get("reason") or "")

    if use_llm and llm_cfg and (page_type == "unknown" or conf < 0.72):
        features = classification.get("features") if isinstance(classification.get("features"), dict) else None
        if features is None:
            from oaao_orchestrator.page_router.features import extract_page_features  # noqa: PLC0415

            features = extract_page_features(html, url)
        try:
            llm_cls = await classify_page_llm(client, features=features, llm_cfg=llm_cfg)
            page_type = str(llm_cls.get("page_type") or page_type)
            conf = float(llm_cls.get("confidence") or conf)
            method = "llm"
            reason = str(llm_cls.get("reason") or reason)
            if isinstance(llm_cls.get("usage"), dict):
                usage = llm_cls["usage"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("research classify llm failed %s: %s", url, exc)

    resolved_kind = resolve_research_kind(page_type)
    if kind not in ("", "auto") and kind != "auto":
        resolved_kind = kind

    items: list[dict[str, str]] = []
    if page_type == "index" or resolved_kind == "index":
        if "arxiv.org/list" in url.lower():
            cands = await _candidates_arxiv_list(client, url)
            items = [{"url": c.url, "title": c.title or c.url} for c in cands]
        else:
            cands = await _candidates_index_page(client, url, {"url": url, "max_items": 80})
            raw_links = [{"url": c.url, "anchor": c.title or c.url} for c in cands]
            from oaao_orchestrator.page_router.link_scoring import score_page_links  # noqa: PLC0415

            scored = score_page_links(html, url, raw_links, limit=50)
            if scored:
                items = [
                    {
                        "url": str(r.get("url") or ""),
                        "title": str(r.get("title") or r.get("url") or ""),
                        "article_score": str(r.get("article_score") or ""),
                        "action": str(r.get("action") or ""),
                    }
                    for r in scored
                    if str(r.get("url") or "")
                ]
            elif use_llm and llm_cfg and len(raw_links) > 5:
                items = await filter_article_links_llm(
                    client,
                    page_url=url,
                    links=[{"url": ln["url"], "title": ln["anchor"]} for ln in raw_links],
                    llm_cfg=llm_cfg,
                )
            else:
                items = filter_article_links(raw_links, keyword_filter=keyword_filter, limit=50)
    elif page_type == "article" or resolved_kind == "static":
        from oaao_orchestrator.page_router.features import extract_page_features  # noqa: PLC0415
        from oaao_orchestrator.research.fetch import resolve_arxiv_content_preview  # noqa: PLC0415

        feat = extract_page_features(html, url)
        title = str(feat.get("title") or feat.get("h1") or url)
        item: dict[str, str] = {"url": url, "title": title}
        if "arxiv.org/abs/" in url.lower():
            item.update(resolve_arxiv_content_preview(html, url))
        items = [item]

    features = classification.get("features") if isinstance(classification.get("features"), dict) else None
    if features is None:
        from oaao_orchestrator.page_router.features import extract_page_features  # noqa: PLC0415

        features = extract_page_features(html, url)

    return {
        "ok": True,
        "url": url,
        "page_type": page_type,
        "confidence": conf,
        "method": method,
        "reason": reason,
        "resolved_kind": resolved_kind,
        "needs_confirmation": needs_confirmation(conf, page_type),
        "items": items[:50],
        "item_count": len(items),
        "html_hash": features.get("html_hash"),
        "usage": usage,
    }


async def discover_research_sources(payload: dict[str, Any]) -> dict[str, Any]:
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    use_llm = bool(payload.get("use_llm", True))
    use_playwright = bool(payload.get("use_playwright", False))
    keyword_filter = str(payload.get("keyword_filter") or "").strip()

    if not sources:
        urls = payload.get("urls") if isinstance(payload.get("urls"), list) else []
        sources = [{"url": u, "kind": "auto"} for u in urls if str(u).strip()]

    previews: list[dict[str, Any]] = []
    total_usage: dict[str, Any] | None = None

    async with httpx.AsyncClient() as client:
        for src in sources:
            if not isinstance(src, dict):
                continue
            url = str(src.get("url") or "").strip()
            if not url:
                continue
            kind = str(src.get("kind") or "auto").lower()
            try:
                prev = await discover_research_source(
                    client,
                    url=url,
                    kind=kind,
                    llm_cfg=llm_cfg,
                    use_llm=use_llm,
                    use_playwright=use_playwright,
                    keyword_filter=keyword_filter,
                )
                previews.append(prev)
                if isinstance(prev.get("usage"), dict):
                    total_usage = _merge_usage(total_usage, prev["usage"])
            except Exception as exc:  # noqa: BLE001
                previews.append({"ok": False, "url": url, "error": str(exc)[:200]})

    any_needs = any(p.get("needs_confirmation") for p in previews if p.get("ok"))
    return {
        "ok": True,
        "previews": previews,
        "needs_confirmation": any_needs,
        "usage": total_usage,
    }


def _merge_usage(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    if not b:
        return a
    if not a:
        return dict(b)
    out = dict(a)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if b.get(key) is not None:
            out[key] = int(out.get(key) or 0) + int(b[key])
    return out
