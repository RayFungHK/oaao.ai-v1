"""Convert arXiv LaTeXML HTML (arxiv.org/html/*) to readable markdown."""

from __future__ import annotations

import re
from html.parser import HTMLParser


def is_arxiv_latexml_html(html: str) -> bool:
    sample = (html or "")[:120000].lower()
    return "ltx_document" in sample or "ltx_page_content" in sample


def arxiv_html_to_markdown(html: str) -> str:
    """Best-effort markdown for arXiv experimental HTML pages."""
    cleaned = _strip_arxiv_chrome(html)
    cleaned = _replace_latexml_math(cleaned)
    cleaned = _replace_algorithms(cleaned)
    cleaned = _replace_html_tables(cleaned)
    cleaned = _replace_figures(cleaned)
    body = _extract_main_html(cleaned)
    return _html_fragment_to_markdown(body)


def _strip_arxiv_chrome(html: str) -> str:
    out = html
    for pat in (
        r"(?is)<nav\b[^>]*class=\"[^\"]*ltx_page_navbar[^\"]*\"[^>]*>.*?</nav>",
        r"(?is)<nav\b[^>]*class=\"[^\"]*ltx_TOC[^\"]*\"[^>]*>.*?</nav>",
        r"(?is)<footer\b[^>]*class=\"[^\"]*ltx_page_footer[^\"]*\"[^>]*>.*?</footer>",
        r"(?is)<header\b[^>]*class=\"[^\"]*ltx_page_header[^\"]*\"[^>]*>.*?</header>",
        r"(?is)<div\b[^>]*class=\"[^\"]*ltx_page_logo[^\"]*\"[^>]*>.*?</div>",
        r"(?is)<div\b[^>]*class=\"[^\"]*package-alerts[^\"]*\"[^>]*>.*?</div>",
        r"(?is)<div\b[^>]*class=\"[^\"]*ltx_authors[^\"]*\"[^>]*>.*?</div>",
        r"(?is)<div\b[^>]*class=\"[^\"]*ltx_dates[^\"]*\"[^>]*>.*?</div>",
        r"(?is)<div\b[^>]*class=\"[^\"]*ltx_classification[^\"]*\"[^>]*>.*?</div>",
        r"(?is)<div\b[^>]*class=\"[^\"]*ltx_license[^\"]*\"[^>]*>.*?</div>",
    ):
        out = re.sub(pat, " ", out)
    return out


def _replace_latexml_math(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        block = match.group(0)
        display = 'display="block"' in block.lower() or "display='block'" in block.lower()
        alt = re.search(r'\balttext="([^"]*)"', block, re.I)
        if alt and alt.group(1).strip():
            tex = alt.group(1).strip()
        else:
            tex_m = re.search(
                r'<annotation[^>]*encoding="application/x-tex"[^>]*>([^<]*)</annotation>',
                block,
                re.I | re.S,
            )
            if tex_m and tex_m.group(1).strip():
                tex = tex_m.group(1).strip()
            else:
                mn = re.search(r"<mn[^>]*>([^<]+)</mn>", block, re.I)
                if mn and mn.group(1).strip():
                    tex = mn.group(1).strip()
                else:
                    mi = re.search(r"<mi[^>]*>([^<]+)</mi>", block, re.I)
                    tex = mi.group(1).strip() if mi and mi.group(1).strip() else " "
        if display or len(tex) > 48 or "\n" in tex:
            return f"\n\n$$\n{tex}\n$$\n\n"
        return f"${tex}$"

    return re.sub(r"<math\b[^>]*>.*?</math>", repl, html, flags=re.I | re.S)


def _replace_html_tables(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        block = match.group(0)
        caption = ""
        cap = re.search(r"(?is)<figcaption[^>]*>(.*?)</figcaption>", block)
        if cap:
            caption = _strip_tags(cap.group(1))
        grid = _parse_table_grid(block)
        if not grid:
            return ""
        md = _grid_to_markdown(grid)
        if caption:
            return f'\n\n{caption}\n\n<pre class="oaao-md-table">\n{md}\n</pre>\n\n'
        return f'\n\n<pre class="oaao-md-table">\n{md}\n</pre>\n\n'

    return re.sub(r"(?is)<figure\b[^>]*\bltx_table\b[^>]*>.*?</figure>", repl, html)


def _replace_algorithms(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        block = match.group(0)
        caption = ""
        cap = re.search(r"(?is)<figcaption[^>]*>(.*?)</figcaption>", block)
        if cap:
            caption = _strip_tags(cap.group(1))
        body = re.sub(r"(?is)<figcaption[^>]*>.*?</figcaption>", " ", block)
        body = re.sub(r"(?is)<table\b.*?</table>", " ", body)
        body = _strip_tags(body)
        body = re.sub(r"\s+\n", "\n", body)
        body = re.sub(r"\n{3,}", "\n\n", body).strip()
        chunks = [c for c in (caption, body) if c]
        if not chunks:
            return "\n\n"
        return '\n\n<pre class="oaao-md-algo">\n' + "\n\n".join(chunks) + "\n</pre>\n\n"

    return re.sub(
        r"(?is)<figure\b[^>]*\bltx_float_algorithm\b[^>]*>.*?</figure>",
        repl,
        html,
    )


def _replace_figures(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        block = match.group(0)
        if re.search(r"(?is)<table\b", block):
            return block
        caption = ""
        cap = re.search(r"(?is)<figcaption[^>]*>(.*?)</figcaption>", block)
        if cap:
            caption = _strip_tags(cap.group(1))
        alt = ""
        img = re.search(r'(?is)<img\b[^>]*\balt="([^"]*)"', block)
        if img and img.group(1).strip():
            alt = img.group(1).strip()
        if caption:
            return f"\n\n{caption}\n\n"
        if alt:
            return f"\n\n[Figure: {alt}]\n\n"
        return "\n\n"

    return re.sub(r"(?is)<figure\b[^>]*>.*?</figure>", repl, html)


def _extract_main_html(html: str) -> str:
    for pat in (
        r'(?is)<article\b[^>]*class="[^"]*ltx_document[^"]*"[^>]*>(.*)</article>',
        r'(?is)<div\b[^>]*class="[^"]*ltx_page_content[^"]*"[^>]*>(.*)</div>\s*<footer',
        r"(?is)<body\b[^>]*>(.*)</body>",
    ):
        m = re.search(pat, html)
        if m and m.group(1).strip():
            return m.group(1)
    return html


class _TableGridParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.grid: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(_strip_tags("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(c.strip() for c in self._row):
                self.grid.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _parse_table_grid(table_html: str) -> list[list[str]]:
    parser = _TableGridParser()
    parser.feed(table_html)
    parser.close()
    return parser.grid


def _grid_to_markdown(grid: list[list[str]]) -> str:
    if not grid:
        return ""
    width = max(len(row) for row in grid)
    norm = [row + [""] * (width - len(row)) for row in grid]
    lines: list[str] = []
    for i, row in enumerate(norm):
        cells = [_escape_md_cell(c) for c in row]
        lines.append("| " + " | ".join(cells) + " |")
        if i == 0:
            lines.append("| " + " | ".join("---" for _ in cells) + " |")
    return "\n".join(lines)


def _escape_md_cell(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).replace("|", "\\|")


def _strip_tags(text: str) -> str:
    text = re.sub(r"(?is)<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


class _FragmentMarkdownParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._stack: list[str] = []
        self._para: list[str] = []
        self._list_type: str | None = None
        self._list_index = 0
        self._skip_depth = 0
        self._pre: list[str] | None = None
        self._pre_kind = ""

    def _flush_para(self) -> None:
        text = _strip_tags("".join(self._para))
        if text:
            self.parts.append(text)
        self._para = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self._skip_depth:
            self._skip_depth += 1
            return
        if tag in ("script", "style"):
            self._skip_depth = 1
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_para()
            level = int(tag[1])
            self._stack.append(f"h{level}")
            return
        if tag == "p":
            self._flush_para()
            self._stack.append("p")
            return
        if tag in ("ul", "ol"):
            self._flush_para()
            self._list_type = tag
            self._list_index = 0
            return
        if tag == "li":
            self._flush_para()
            self._stack.append("li")
            return
        if tag == "br":
            self._para.append("\n")
        if tag == "pre":
            self._flush_para()
            self._pre = []
            self._pre_kind = ""
            for key, val in attrs:
                if key.lower() == "class" and val:
                    self._pre_kind = val.lower()
            return
        if tag == "section":
            self._flush_para()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._skip_depth:
            self._skip_depth -= 1
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._stack and self._stack[-1] == tag:
            text = _strip_tags("".join(self._para))
            self._para = []
            self._stack.pop()
            if text:
                level = int(tag[1])
                self.parts.append(f"{'#' * level} {text}")
            return
        if tag == "p" and self._stack and self._stack[-1] == "p":
            self._flush_para()
            self._stack.pop()
            return
        if tag == "li" and self._stack and self._stack[-1] == "li":
            text = _strip_tags("".join(self._para))
            self._para = []
            self._stack.pop()
            if text:
                if self._list_type == "ol":
                    self._list_index += 1
                    self.parts.append(f"{self._list_index}. {text}")
                else:
                    self.parts.append(f"- {text}")
            return
        if tag in ("ul", "ol"):
            self._list_type = None
            self._list_index = 0
            self.parts.append("")
            return
        if tag == "pre" and self._pre is not None:
            block = "".join(self._pre).strip("\n")
            kind = self._pre_kind
            self._pre = None
            self._pre_kind = ""
            if block:
                rows = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
                if rows:
                    if self.parts and self.parts[-1] != "":
                        self.parts.append("")
                    if kind == "oaao-md-table":
                        self.parts.append("\n".join(rows))
                    else:
                        self.parts.append("\n\n".join(rows))
                    self.parts.append("")
            return
        if tag == "section":
            self._flush_para()
            self.parts.append("")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._pre is not None:
            self._pre.append(data)
            return
        if data:
            self._para.append(data)


def _html_fragment_to_markdown(fragment: str) -> str:
    parser = _FragmentMarkdownParser()
    parser.feed(fragment)
    parser.close()
    parser._flush_para()
    lines: list[str] = []
    for part in parser.parts:
        chunk = re.sub(r"[ \t]+\n", "\n", part.strip())
        chunk = re.sub(r"\n{3,}", "\n\n", chunk)
        if not chunk:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        if chunk.startswith("| ") or "\n| " in chunk or chunk.startswith("#"):
            if lines and lines[-1] != "":
                lines.append("")
            lines.extend(chunk.split("\n"))
            if not (chunk.startswith("| ") or "\n| " in chunk):
                lines.append("")
            continue
        if chunk.startswith("Algorithm ") or "\nAlgorithm " in chunk:
            if lines and lines[-1] != "":
                lines.append("")
            lines.extend(chunk.split("\n"))
            lines.append("")
            continue
        for para in re.split(r"\n\s*\n", chunk):
            p = re.sub(r"\s+", " ", para.strip())
            if p:
                lines.append(p)
        lines.append("")
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
