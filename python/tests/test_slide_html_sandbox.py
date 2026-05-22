"""SD-3 — slide HTML sandbox validation."""

from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html


def test_validate_slide_html_accepts_minimal_document() -> None:
    html = """<!DOCTYPE html><html><head><title>x</title></head>
<body><h1>Hi</h1></body></html>"""
    ok, errors = validate_slide_html(html)
    assert ok is True
    assert errors == []


def test_validate_slide_html_rejects_fence_and_missing_body() -> None:
    ok, errors = validate_slide_html("```html\n<div>bad</div>\n```")
    assert ok is False
    assert any("fence" in e or "body" in e or "html" in e for e in errors)
