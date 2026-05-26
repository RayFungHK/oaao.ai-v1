"""Parse HTML tables into row dicts (stdlib — no BeautifulSoup required)."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any


def _strip_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


class _TableCollector(HTMLParser):
    def __init__(self, table_index: int = 0, css_hint: str = "") -> None:
        super().__init__()
        self._table_index = max(0, table_index)
        self._css_hint = (css_hint or "").strip().lower()
        self._tables: list[list[list[str]]] = []
        self._current_table: list[list[str]] | None = None
        self._current_row: list[str] | None = None
        self._cell_buf: list[str] = []
        self._in_cell = False
        self._table_counter = -1
        self._table_class = ""
        self._table_id = ""
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag == "table":
            self._table_counter += 1
            self._table_class = attr_map.get("class", "").lower()
            self._table_id = attr_map.get("id", "").lower()
            if self._match_table():
                self._current_table = []
        elif self._current_table is not None and tag in ("thead", "tbody", "tfoot"):
            return
        elif self._current_table is not None and tag == "tr":
            self._current_row = []
        elif self._current_row is not None and tag in ("td", "th"):
            self._in_cell = True
            self._cell_buf = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("td", "th") and self._in_cell:
            cell = _strip_tags("".join(self._cell_buf))
            if self._current_row is not None:
                self._current_row.append(cell)
            self._in_cell = False
            self._cell_buf = []
        elif tag == "tr" and self._current_row is not None and self._current_table is not None:
            if any(c.strip() for c in self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table" and self._current_table is not None:
            if self._current_table:
                self._tables.append(self._current_table)
            self._current_table = None

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_buf.append(data)

    def _match_table(self) -> bool:
        if self._table_counter != self._table_index:
            return False
        if not self._css_hint:
            return True
        hint = self._css_hint.lstrip(".#")
        if self._css_hint.startswith("#"):
            return hint == self._table_id
        if self._css_hint.startswith("."):
            return hint in self._table_class.split()
        return hint in (self._table_id, self._table_class)

    @property
    def tables(self) -> list[list[list[str]]]:
        return self._tables


def parse_html_tables(html: str, *, table_selector: str = "", table_index: int = 0) -> list[dict[str, Any]]:
    """Extract rows from the Nth matching table; first row is header."""
    hint = table_selector.strip()
    idx = table_index
    if hint.startswith("table:"):
        try:
            idx = int(hint.split(":", 1)[1])
            hint = ""
        except ValueError:
            hint = hint.split(":", 1)[1]

    parser = _TableCollector(table_index=idx, css_hint=hint)
    parser.feed(html)
    parser.close()
    tables = parser.tables
    if not tables:
        return []
    grid = tables[0]
    if len(grid) < 2:
        return []
    headers = [_safe_col(h) for h in grid[0]]
    out: list[dict[str, Any]] = []
    for row in grid[1:501]:
        if len(row) < len(headers):
            row = row + [""] * (len(headers) - len(row))
        out.append({headers[i]: row[i].strip() for i in range(len(headers)) if headers[i]})
    return out


def _safe_col(name: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_]+", "_", name.strip()).strip("_").lower()
    return clean or "col"
