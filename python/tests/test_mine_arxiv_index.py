"""Tests for arXiv index heuristic parsing and mine index worker paths."""

from __future__ import annotations

from oaao_orchestrator.mine.arxiv_index import parse_arxiv_list_html, project_rows_to_schema

SAMPLE_ARXIV_LIST = """
<html><body>
<div class="list">
<p>arXiv:2605.23904
Title: Sample Paper Alpha
</p>
<p>See also <a href="https://arxiv.org/abs/2605.23904">abs</a></p>
<p>arXiv:2605.23905
Title: Another Paper Beta
</p>
<a href="/abs/2605.23905">link</a>
</div>
</body></html>
"""

ARXIV_SCHEMA = {
    "table_name": "papers",
    "columns": [
        {"name": "arxiv_id", "type": "text"},
        {"name": "title", "type": "text"},
    ],
    "natural_key": ["arxiv_id"],
}


def test_parse_arxiv_list_html_extracts_ids_and_titles() -> None:
    rows = parse_arxiv_list_html(SAMPLE_ARXIV_LIST)
    assert len(rows) == 2
    assert rows[0]["arxiv_id"] == "2605.23904"
    assert rows[0]["title"] == "Sample Paper Alpha"
    assert rows[1]["arxiv_id"] == "2605.23905"
    assert rows[1]["title"] == "Another Paper Beta"
    assert rows[0]["abs_url"] == "https://arxiv.org/abs/2605.23904"


def test_project_rows_to_schema_filters_columns() -> None:
    rows = parse_arxiv_list_html(SAMPLE_ARXIV_LIST)
    projected = project_rows_to_schema(rows, ARXIV_SCHEMA)
    assert len(projected) == 2
    assert set(projected[0].keys()) == {"arxiv_id", "title"}
    assert "abs_url" not in projected[0]
