"""Step-by-step research source discovery — classify page and rank links (max depth)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.page_router.classify import (
    classify_page,
    classify_page_llm,
    classify_page_rules,
    needs_confirmation,
    resolve_research_kind,
)
from oaao_orchestrator.page_router.features import extract_page_features
from oaao_orchestrator.page_router.link_scoring import infer_item_url_pattern, score_page_links
from oaao_orchestrator.research.discover import _fetch_page_html
from oaao_orchestrator.research.fetch import resolve_arxiv_content_preview

logger = logging.getLogger(__name__)

MAX_DISCOVER_DEPTH = 3
_MIN_GOOD_FETCH = 2
_AUTO_DRILL_MIN_SCORE = 0.12
_DRILL_NOISE = frozenset({"login", "sign up", "sign in", "register", "ignoreme", "ignore", "about", "contact", "privacy", "terms", "home", "menu"})


def _count_good_fetch(fetch_items: list[dict[str, Any]]) -> int:
    return sum(
        1
        for f in fetch_items
        if float(f.get("article_score") or 0) >= 0.55 or str(f.get("action") or "") == "fetch"
    )


def _pick_auto_drill_url(drill_items: list[dict[str, Any]]) -> str | None:
    ranked = sorted(drill_items, key=lambda r: float(r.get("article_score") or 0), reverse=True)
    for row in ranked:
        score = float(row.get("article_score") or 0)
        if score < _AUTO_DRILL_MIN_SCORE:
            continue
        anchor = str(row.get("anchor") or row.get("display_title") or row.get("title") or "").lower().strip()
        if anchor in _DRILL_NOISE:
            continue
        if any(tok in anchor for tok in ("login", "sign in", "sign up", "register", "password")):
            continue
        url = str(row.get("url") or "").strip()
        if url:
            return url
    return None


def _arxiv_list_fetch_items(html: str) -> list[dict[str, Any]]:
    from oaao_orchestrator.mine.arxiv_index import parse_arxiv_list_html  # noqa: PLC0415

    rows = parse_arxiv_list_html(html, limit=40)
    out: list[dict[str, Any]] = []
    for row in rows:
        abs_url = str(row.get("abs_url") or "").strip()
        if not abs_url:
            continue
        arxiv_id = str(row.get("arxiv_id") or abs_url.rsplit("/", 1)[-1])
        base_id = arxiv_id.split("v")[0]
        title = str(row.get("title") or "").strip() or f"arXiv {arxiv_id}"
        out.append(
            {
                "url": abs_url,
                "title": title,
                "display_title": title,
                "anchor": title,
                "article_score": 0.92,
                "action": "fetch",
                "reasons": ["arxiv-abs"],
                "link_kind": "abs",
                "layer": "metadata",
                "content_url": f"https://arxiv.org/html/{base_id}v1",
                "content_hint": "Full text from arXiv HTML (experimental) at fetch time",
            }
        )
    return out


def _arxiv_abs_drill_items(html: str, abs_url: str, title: str) -> list[dict[str, Any]]:
    preview = resolve_arxiv_content_preview(html, abs_url)
    kind = str(preview.get("content_kind") or "")
    if kind not in {"arxiv_html_experimental", "ar5iv_html"}:
        return []
    cu = str(preview.get("content_url") or "").strip()
    if not cu:
        return []
    if kind == "ar5iv_html":
        anchor = "ar5iv HTML"
        display = "ar5iv HTML — full text"
        reasons = ["arxiv-ar5iv-html"]
    else:
        anchor = "HTML (experimental)"
        display = "HTML (experimental) — full text"
        reasons = ["arxiv-html-experimental"]
    return [
        {
            "url": cu,
            "title": f"{title} — {anchor}",
            "display_title": display,
            "anchor": anchor,
            "article_score": 0.98,
            "action": "drill",
            "reasons": reasons,
            "link_kind": "html",
            "layer": "fulltext",
            "content_hint": str(preview.get("content_hint") or ""),
        }
    ]


def _index_url_from_path(root_url: str, path: list[dict[str, Any]]) -> str:
    for step in path:
        u = str(step.get("url") or "").strip()
        pt = str(step.get("page_type") or "").lower()
        if "arxiv.org/list" in u.lower() or pt == "index":
            return u
    if "arxiv.org/list" in root_url.lower():
        return root_url
    for step in reversed(path):
        pt = str(step.get("page_type") or "").lower()
        if pt in ("index", "unknown"):
            return str(step.get("url") or root_url).strip() or root_url
    return root_url


async def discover_research_step(
    client: httpx.AsyncClient,
    *,
    url: str,
    depth: int = 1,
    max_depth: int = MAX_DISCOVER_DEPTH,
    parent_url: str | None = None,
    llm_cfg: dict[str, Any] | None = None,
    use_llm: bool = True,
    use_playwright: bool = False,
) -> dict[str, Any]:
    url = (url or "").strip()
    if not url:
        return {"ok": False, "error": "url_required"}

    depth = max(1, min(int(depth or 1), max_depth))
    max_depth = max(1, min(int(max_depth or MAX_DISCOVER_DEPTH), MAX_DISCOVER_DEPTH))

    ruled = classify_page_rules(url)
    html = await _fetch_page_html(client, url, use_playwright=use_playwright)
    classification = ruled or classify_page(html, url)

    conf = float(classification.get("confidence") or 0)
    page_type = str(classification.get("page_type") or "unknown")
    method = str(classification.get("method") or "feature")
    reason = str(classification.get("reason") or "")

    if use_llm and llm_cfg and (page_type == "unknown" or conf < 0.72):
        features = classification.get("features") if isinstance(classification.get("features"), dict) else None
        if features is None:
            features = extract_page_features(html, url)
        try:
            llm_cls = await classify_page_llm(client, features=features, llm_cfg=llm_cfg)
            page_type = str(llm_cls.get("page_type") or page_type)
            conf = float(llm_cls.get("confidence") or conf)
            method = "llm"
            reason = str(llm_cls.get("reason") or reason)
        except Exception as exc:  # noqa: BLE001
            logger.warning("discover_step llm failed %s: %s", url, exc)

    features = classification.get("features") if isinstance(classification.get("features"), dict) else None
    if features is None:
        features = extract_page_features(html, url)

    links_raw = features.get("links_sample") if isinstance(features.get("links_sample"), list) else []
    fetch_items: list[dict[str, Any]] = []
    drill_items: list[dict[str, Any]] = []

    if "arxiv.org/list" in url.lower():
        fetch_items = _arxiv_list_fetch_items(html)
    else:
        scored = score_page_links(html, url, links_raw, limit=80)
        for row in scored:
            action = str(row.get("action") or "skip")
            item = {
                "url": row.get("url"),
                "title": row.get("display_title") or row.get("title") or row.get("url"),
                "display_title": row.get("display_title") or row.get("title") or row.get("url"),
                "anchor": row.get("anchor") or "",
                "article_score": row.get("article_score"),
                "action": action,
                "reasons": row.get("reasons") or [],
                "link_kind": row.get("link_kind") or "link",
            }
            if action == "fetch":
                fetch_items.append(item)
            elif action in ("maybe", "drill"):
                if action == "drill" or float(row.get("article_score") or 0) < 0.55:
                    drill_items.append(item)
                else:
                    fetch_items.append(item)

    if page_type == "article":
        title = str(features.get("title") or features.get("h1") or url)
        item: dict[str, Any] = {
            "url": url,
            "title": title,
            "display_title": title,
            "article_score": 1.0,
            "action": "fetch",
            "reasons": ["page-is-article"],
            "link_kind": "article",
            "layer": "fulltext",
        }
        if "arxiv.org/abs/" in url.lower():
            item.update(resolve_arxiv_content_preview(html, url))
            item["layer"] = "metadata"
            item["link_kind"] = "abs"
            drill_items = _arxiv_abs_drill_items(html, url, title)
        else:
            drill_items = []
        fetch_items = [item]
    elif "arxiv.org/html/" in url.lower():
        title = str(features.get("title") or features.get("h1") or url)
        fetch_items = [
            {
                "url": url,
                "title": title,
                "display_title": title,
                "article_score": 1.0,
                "action": "fetch",
                "reasons": ["arxiv-html-experimental"],
                "link_kind": "html",
                "layer": "fulltext",
            }
        ]
        drill_items = []
        page_type = "article"
        reason = reason or "arXiv HTML (experimental) full-text page"

    is_arxiv_list = "arxiv.org/list" in url.lower()
    can_drill_hubs = depth < max_depth and page_type in ("index", "unknown") and len(drill_items) > 0
    can_drill_fetch_preview = (
        depth < max_depth and page_type in ("index", "unknown") and len(fetch_items) > 0
    )
    can_drill_content = depth < max_depth and len(drill_items) > 0 and (
        "arxiv.org/abs/" in url.lower() or any(str(d.get("layer") or "") == "fulltext" for d in drill_items)
    )
    can_drill = can_drill_hubs or can_drill_fetch_preview or can_drill_content

    auto_drill_url: str | None = None
    if can_drill:
        auto_drill_url = _pick_auto_drill_url(drill_items)
        if not auto_drill_url and is_arxiv_list and fetch_items:
            auto_drill_url = str(fetch_items[0].get("url") or "").strip() or None
        elif not auto_drill_url and "arxiv.org/abs/" in url.lower() and drill_items:
            auto_drill_url = str(drill_items[0].get("url") or "").strip() or None

    good_fetch = _count_good_fetch(fetch_items)
    auto_sufficient = False
    if page_type == "article" and "arxiv.org/html/" in url.lower():
        auto_sufficient = True
    elif page_type == "article" and "arxiv.org/abs/" in url.lower() and not drill_items:
        auto_sufficient = True
    elif is_arxiv_list:
        auto_sufficient = False
    elif good_fetch >= _MIN_GOOD_FETCH and not can_drill_fetch_preview:
        auto_sufficient = True
    elif page_type == "article":
        auto_sufficient = True

    page_layer = "index"
    if "arxiv.org/html/" in url.lower():
        page_layer = "fulltext"
    elif "arxiv.org/abs/" in url.lower():
        page_layer = "metadata"
    elif is_arxiv_list or page_type == "index":
        page_layer = "index"

    html_drill_available = any(str(d.get("layer") or "") == "fulltext" for d in drill_items)
    fetch_resolution_hint = ""
    if page_layer == "fulltext":
        fetch_resolution_hint = "Full-text HTML page — saving watches the list/index and fetches all papers through /abs/ → HTML."
    elif page_layer == "metadata":
        if html_drill_available:
            fetch_resolution_hint = (
                "Queue uses /abs/ (metadata). At fetch time each job tries HTML (experimental) full text first."
            )
        else:
            fetch_resolution_hint = (
                "No HTML (experimental) link on this /abs/ page — fetch will use abstract/metadata only."
            )
    elif is_arxiv_list:
        fetch_resolution_hint = (
            "Index list — papers queue as /abs/ URLs; fetch worker auto-resolves HTML (experimental) per paper."
        )

    suggested = "confirm_fetch"
    if page_type == "article":
        suggested = "confirm_article"
    elif auto_sufficient:
        suggested = "confirm_fetch"
    elif auto_drill_url:
        suggested = "auto_drill"
    elif can_drill:
        suggested = "pick_drill_or_fetch"

    return {
        "ok": True,
        "url": url,
        "parent_url": parent_url,
        "depth": depth,
        "max_depth": max_depth,
        "page_type": page_type,
        "confidence": conf,
        "method": method,
        "reason": reason,
        "resolved_kind": resolve_research_kind(page_type),
        "needs_confirmation": needs_confirmation(conf, page_type),
        "html_hash": features.get("html_hash"),
        "suggested_action": suggested,
        "can_drill_down": can_drill,
        "auto_drill_url": auto_drill_url,
        "auto_sufficient": auto_sufficient,
        "good_fetch_count": good_fetch,
        "can_drill_fetch_preview": can_drill_fetch_preview,
        "page_layer": page_layer,
        "layer_chain": "index → metadata (/abs/) → fulltext (HTML experimental)",
        "html_drill_available": html_drill_available,
        "fetch_resolution_hint": fetch_resolution_hint,
        "fetch_candidates": fetch_items[:40],
        "drill_candidates": drill_items[:25],
        "items": (fetch_items + [i for i in drill_items if i not in fetch_items])[:50],
    }


def finalize_discover_source(
    *,
    root_url: str,
    path: list[dict[str, Any]],
    selected_article_urls: list[str],
    final_index_url: str | None = None,
) -> dict[str, Any]:
    """Build a watch source config from wizard selections."""
    articles = [u.strip() for u in selected_article_urls if str(u).strip()]
    pattern = infer_item_url_pattern(articles) if articles else None

    last = path[-1] if path else {}
    page_type = str(last.get("page_type") or "index")
    index_from_path = _index_url_from_path(root_url, path)
    has_list_index = "arxiv.org/list" in index_from_path.lower() or any(
        str(s.get("page_type") or "").lower() == "index" for s in path
    )

    if has_list_index and page_type == "article":
        page_type = "index"

    eff_url = (final_index_url or index_from_path or str(last.get("url") or root_url)).strip()

    if page_type == "article" and len(articles) <= 1 and not has_list_index:
        u = articles[0] if articles else eff_url
        return {
            "url": u,
            "kind": "static",
            "resolved_kind": "static",
            "discovered_mode": "static",
            "discover_path": path,
        }

    src: dict[str, Any] = {
        "url": eff_url,
        "kind": "index" if page_type != "rss" else "rss",
        "resolved_kind": "index" if page_type != "rss" else "rss",
        "discovered_mode": "index" if page_type != "rss" else "rss",
        "discover_path": path,
    }
    if pattern:
        src["item_url_pattern"] = pattern
        src["link_pattern"] = pattern
    if last.get("html_hash"):
        src["html_hash"] = last["html_hash"]
    if articles:
        src["confirmed_sample_urls"] = articles[:20]
    return src
