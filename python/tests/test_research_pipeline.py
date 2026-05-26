"""Research pipeline P0-P4 unit tests."""

from oaao_orchestrator.research.document_schema import ArticleMetadata, wrap_standard_markdown
from oaao_orchestrator.research.extract.dispatcher import detect_source_kind
from oaao_orchestrator.research.arxiv_html_md import _replace_latexml_math
from oaao_orchestrator.vault_document_extract import chunk_plain_text
from oaao_orchestrator.vault_rerank import _parse_index_scores


def test_detect_source_kind() -> None:
    assert detect_source_kind("https://arxiv.org/abs/2312.01523") == "arxiv"
    assert detect_source_kind("https://ar5iv.org/html/2312.01523v2") == "arxiv"
    assert detect_source_kind("https://example.com/paper.pdf") == "pdf"
    assert detect_source_kind("https://example.com/blog/post") == "web"


def test_standard_markdown_frontmatter() -> None:
    meta = ArticleMetadata(
        title="SymNoise",
        authors=["Alice", "Bob"],
        arxiv_id="2312.01523",
        source_url="https://arxiv.org/abs/2312.01523",
        content_kind="ar5iv_html",
        content_hash="abc123",
    )
    md = wrap_standard_markdown(meta=meta, body="Body text")
    assert "authors:" in md
    assert "arxiv_id:" in md
    assert "content_kind:" in md
    assert "content_hash:" in md


def test_latexml_math_wraps_dollars() -> None:
    html = '<p>x=<math alttext="29.79" class="ltx_Math"><mn>29.79</mn></math></p>'
    out = _replace_latexml_math(html)
    assert "$29.79$" in out


def test_chunk_plain_text_avoids_math_split() -> None:
    text = "Intro " + "$" + "E=mc^2" + "$" + " " + ("word " * 80)
    chunks = chunk_plain_text(text, size=40, overlap=0)
    assert chunks
    for ch in chunks:
        if "$" in ch:
            assert ch.count("$") >= 2


def test_rerank_parse_index_scores() -> None:
    data = {"results": [{"index": 2, "score": 0.9}, {"index": 0, "score": 0.5}]}
    ranked = _parse_index_scores(data, top_n=2)
    assert ranked[0][0] == 2
    assert ranked[0][1] == 0.9
