"""arXiv LaTeXML HTML → markdown conversion."""

from __future__ import annotations

from oaao_orchestrator.research.arxiv_html_md import (
    _grid_to_markdown,
    _replace_html_tables,
    _replace_latexml_math,
    arxiv_html_to_markdown,
    is_arxiv_latexml_html,
)

SAMPLE_TABLE_FIGURE = """
<figure class="ltx_table" id="S1.T1">
<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Win rates</figcaption>
<table class="ltx_tabular">
<thead><tr><th></th><th>Alpaca</th><th>ShareGPT</th></tr></thead>
<tbody>
<tr><th>LLaMA-2 7B</th><td>29.79</td><td>68.74</td></tr>
<tr><th>+SymNoise</th><td>69.04</td><td>78.67</td></tr>
</tbody>
</table>
</figure>
"""

SAMPLE_ALGO_FIGURE = """
<figure class="ltx_float ltx_float_algorithm ltx_framed_top" id="alg1">
<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_float">Algorithm 1 </span>NEFTune</figcaption>
<table class="ltx_tabular"><tr><td>Input: dataset</td></tr></table>
<div class="ltx_listing">for each batch: add noise</div>
</figure>
"""

SAMPLE_DOC = f"""
<article class="ltx_document">
<section><h2>1 Introduction</h2>
<p>Score improved from <math alttext="29.79" class="ltx_Math"><mn>29.79</mn></math>% to 69.04%.</p>
{SAMPLE_TABLE_FIGURE}
{SAMPLE_ALGO_FIGURE}
</section>
</article>
"""


def test_is_arxiv_latexml_html() -> None:
    assert is_arxiv_latexml_html('<article class="ltx_document">')
    assert not is_arxiv_latexml_html("<html><body>blog</body></html>")


def test_replace_latexml_math_uses_alttext() -> None:
    html = '<p>x=<math alttext="29.79" class="ltx_Math"><mn>29.79</mn></math>%</p>'
    out = _replace_latexml_math(html)
    assert "29.79" in out
    assert out.count("29.79") == 1


def test_replace_html_tables_only_ltx_table_figures() -> None:
    html = SAMPLE_ALGO_FIGURE + SAMPLE_TABLE_FIGURE
    out = _replace_html_tables(html)
    assert "oaao-md-table" in out
    assert "Algorithm 1" in out
    assert out.count("oaao-md-table") == 1


def test_grid_to_markdown() -> None:
    md = _grid_to_markdown([["", "A", "B"], ["row", "1", "2"]])
    assert "| A | B |" in md
    assert "| --- | --- |" in md


def test_arxiv_html_to_markdown_tables_and_algorithms() -> None:
    md = arxiv_html_to_markdown(SAMPLE_DOC)
    assert "Table 1:" in md
    assert "| Alpaca | ShareGPT |" in md
    assert "| 29.79 | 68.74 |" in md
    assert "Algorithm 1" in md
    assert "for each batch" in md
    assert "29.79" in md
    assert "29.79 29.79" not in md
