"""Local HTML sandbox checks for slide designer (SD-3 self-eval loop)."""

from __future__ import annotations

import re
from html.parser import HTMLParser


_VOID_TAGS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
)


class _TagBalanceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() not in _VOID_TAGS:
            self.stack.append(tag.lower())

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """XML-style <meta .../> — void; no stack entry."""

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        # Python HTMLParser emits </meta> for <meta .../> even though meta is void.
        if t in _VOID_TAGS:
            return
        if not self.stack:
            self.errors.append(f"unexpected closing </{t}>")
            return
        if self.stack[-1] != t:
            self.errors.append(f"mismatched tag: expected </{self.stack[-1]}>, got </{t}>")
        else:
            self.stack.pop()


def validate_slide_layout(html: str) -> list[str]:
    """Deck preview alignment — fixed 1280×720 canvas, no responsive full-viewport body."""
    errors: list[str] = []
    raw = (html or "").strip()
    if not raw:
        return ["empty document"]
    lower = raw.lower()
    if "oaao-slide-canvas-lock" not in lower and "1280px" not in lower:
        errors.append("missing fixed slide canvas (1280×720 lock styles)")
    if re.search(r"min-height\s*:\s*100vh", lower):
        errors.append("body uses min-height:100vh — breaks thumbnail alignment")
    if re.search(r"width\s*:\s*100%\s*!important", lower) and "1280px" not in lower:
        errors.append("responsive width:100% on root — use fixed canvas")
    if 'name="viewport" content="width=device-width' in lower:
        errors.append("viewport is device-width — use fixed width=1280")
    return errors


def validate_slide_html(html: str) -> tuple[bool, list[str]]:
    """Syntax-ish checks before accepting sandbox HTML output."""
    errors: list[str] = []
    raw = (html or "").strip()
    if len(raw) < 40:
        errors.append("HTML too short")
        return False, errors

    lower = raw.lower()
    if "<html" not in lower or "</html>" not in lower:
        errors.append("missing <html> root")
    if "<body" not in lower or "</body>" not in lower:
        errors.append("missing <body>")
    if "```" in raw:
        errors.append("markdown code fence left in output")
    if raw.count("<script") > 2:
        errors.append("too many <script> blocks")

    parser = _TagBalanceParser()
    try:
        parser.feed(raw)
        parser.close()
    except Exception as exc:
        errors.append(f"parse error: {exc}")
    errors.extend(parser.errors[:6])
    if parser.stack:
        errors.append(f"unclosed tags: {', '.join(parser.stack[-5:])}")

    # Basic entity / broken attribute heuristic
    if re.search(r"<[^>]+<", raw):
        errors.append("nested < inside tag")

    errors.extend(validate_slide_layout(raw)[:4])

    return len(errors) == 0, errors
