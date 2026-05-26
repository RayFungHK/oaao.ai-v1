"""Tests for page router — L0 rules and L1 feature scoring."""

from __future__ import annotations

from oaao_orchestrator.page_router.classify import classify_page, classify_page_rules
from oaao_orchestrator.page_router.features import extract_page_features, score_index_vs_article

INDEX_HTML = """
<html><head><title>Blog Home</title></head><body>
<ul>
<li><a href="/post/one">First post title here</a></li>
<li><a href="/post/two">Second post title</a></li>
<li><a href="/post/three">Third post</a></li>
<li><a href="/post/four">Fourth</a></li>
<li><a href="/post/five">Fifth</a></li>
<li><a href="/post/six">Sixth</a></li>
</ul>
<p>Welcome to our blog.</p>
</body></html>
"""

ARTICLE_HTML = """
<html><head><title>My Article</title>
<meta property="og:type" content="article">
</head><body>
<h1>My Article</h1>
<article>
<p>Lorem ipsum dolor sit amet. """ + ("word " * 200) + """</p>
<p>More content here with substantial body text for classification.</p>
</article>
<a href="/about">About</a>
</body></html>
"""


def test_classify_page_rules_arxiv_list() -> None:
    r = classify_page_rules("https://arxiv.org/list/cs.AI/recent")
    assert r is not None
    assert r["page_type"] == "index"
    assert r["confidence"] >= 0.9


def test_classify_page_rules_arxiv_abs() -> None:
    r = classify_page_rules("https://arxiv.org/abs/2605.23904")
    assert r is not None
    assert r["page_type"] == "article"


def test_feature_score_index_page() -> None:
    feat = extract_page_features(INDEX_HTML, "https://example.com/blog/")
    page_type, conf, _reason = score_index_vs_article(feat)
    assert page_type == "index"
    assert conf >= 0.5


def test_feature_score_article_page() -> None:
    feat = extract_page_features(ARTICLE_HTML, "https://example.com/blog/my-article")
    page_type, conf, _reason = score_index_vs_article(feat)
    assert page_type == "article"
    assert conf >= 0.5


def test_classify_page_article_without_rules() -> None:
    r = classify_page(ARTICLE_HTML, "https://example.com/p/my-article")
    assert r["page_type"] == "article"
