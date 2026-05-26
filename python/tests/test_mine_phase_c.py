"""Phase C tests — HTML table parse and multi-source merge."""

from __future__ import annotations

from oaao_orchestrator.mine.html_table import parse_html_tables
from oaao_orchestrator.mine.sqlite_store import merge_rows_for_schema


SAMPLE_HTML = """
<html><body>
<table id="prices">
<tr><th>Symbol</th><th>Price</th></tr>
<tr><td>0700.HK</td><td>380</td></tr>
<tr><td>9988.HK</td><td>80.5</td></tr>
</table>
<table class="other">
<tr><th>X</th></tr>
<tr><td>1</td></tr>
</table>
</body></html>
"""


def test_parse_html_table_by_index() -> None:
    rows = parse_html_tables(SAMPLE_HTML, table_index=0)
    assert len(rows) == 2
    assert rows[0]["symbol"] == "0700.HK"
    assert rows[0]["price"] == "380"


def test_parse_html_table_by_selector() -> None:
    rows = parse_html_tables(SAMPLE_HTML, table_selector="#prices")
    assert len(rows) == 2
    assert rows[1]["symbol"] == "9988.HK"


def test_parse_html_table_index_hint() -> None:
    rows = parse_html_tables(SAMPLE_HTML, table_selector="table:1")
    assert len(rows) == 1
    assert rows[0]["x"] == "1"


def test_merge_rows_for_schema_flattens_batches() -> None:
    batches = [
        [{"a": 1}, {"a": 2}],
        [{"b": 3}],
    ]
    merged = merge_rows_for_schema(batches)
    assert len(merged) == 3
    assert merged[0]["a"] == 1
    assert merged[2]["b"] == 3


def test_merge_rows_caps_at_500() -> None:
    big = [[{"i": i}] for i in range(600)]
    flat = [row for batch in big for row in batch]
    merged = merge_rows_for_schema([flat])
    assert len(merged) == 500
