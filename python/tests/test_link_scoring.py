"""Tests for HTML structure-aware link scoring."""

from oaao_orchestrator.page_router.link_scoring import (
    infer_item_url_pattern,
    score_link_as_article,
    score_page_links,
)

_SAMPLE_INDEX_HTML = """
<html><body>
<nav><a href="/about">About</a><a href="/page/2">Next</a></nav>
<main>
  <h1>Recent papers</h1>
  <a href="https://arxiv.org/abs/2605.23899">Cool transformer paper title here</a>
  <a href="https://arxiv.org/abs/2605.11111">Another long title about models</a>
  <a href="/category/ml">Machine Learning</a>
</main>
</body></html>
"""


def test_score_arxiv_abs_in_main_region_high():
    row = score_link_as_article(
        url="https://arxiv.org/abs/2605.23899",
        anchor="Cool transformer paper title here",
        page_url="https://arxiv.org/list/cs.AI/recent",
        region_html="<main><a href='https://arxiv.org/abs/2605.23899'>Cool transformer paper title here</a></main>",
        full_html=_SAMPLE_INDEX_HTML,
    )
    assert row["action"] in ("fetch", "maybe")
    assert float(row["article_score"]) >= 0.55
    assert "arxiv-paper" in row["reasons"]


def test_nav_link_scores_low():
    row = score_link_as_article(
        url="https://example.com/about",
        anchor="About",
        page_url="https://example.com/blog/",
        region_html=_SAMPLE_INDEX_HTML,
        full_html=_SAMPLE_INDEX_HTML,
    )
    assert float(row["article_score"]) < 0.5
    assert row["action"] in ("skip", "drill", "maybe")


def test_score_page_links_orders_by_score():
    links = [
        {"url": "https://example.com/about", "anchor": "About"},
        {"url": "https://arxiv.org/abs/2605.23899", "anchor": "Cool transformer paper title here"},
    ]
    scored = score_page_links(_SAMPLE_INDEX_HTML, "https://arxiv.org/list/cs.AI/recent", links)
    assert len(scored) == 2
    assert scored[0]["url"].endswith("2605.23899")


def test_format_sidecar_filtered():
    links = [
        {"url": "https://arxiv.org/html/2605.23899", "anchor": "html"},
        {"url": "https://arxiv.org/abs/2605.23899", "anchor": "2605.23899"},
    ]
    scored = score_page_links(_SAMPLE_INDEX_HTML, "https://arxiv.org/list/cs.AI/recent", links)
    urls = [r["url"] for r in scored]
    assert any("abs/" in u for u in urls)
    assert not any("/html/" in u for u in urls)


def test_link_display_title_from_url():
    from oaao_orchestrator.page_router.link_scoring import link_display_title

    assert link_display_title("https://arxiv.org/html/2605.23899", "html").startswith("arXiv")
    assert "Cool" in link_display_title("https://example.com/blog/my-post", "Cool post title")
    urls = [
        "https://arxiv.org/abs/2605.23899",
        "https://arxiv.org/abs/2605.11111",
    ]
    pat = infer_item_url_pattern(urls)
    assert pat is not None
    assert "arxiv" in pat
