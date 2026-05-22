"""Fixed slide canvas normalization."""

from oaao_orchestrator.slide_project.canvas import (
    build_fallback_slide_document,
    normalize_slide_html,
    slide_canvas_height,
    slide_canvas_width,
)
from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html


def test_normalize_injects_fixed_canvas() -> None:
    raw = """<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width"/></head>
<body><p>Hi</p></body></html>"""
    out = normalize_slide_html(raw)
    w, h = slide_canvas_width(), slide_canvas_height()
    assert "oaao-slide-canvas-lock" in out
    assert "oaao-slide-canvas" in out
    assert f"width={w}" in out
    assert f"{w}px" in out
    assert f"{h}px" in out


def test_fallback_document_has_canvas() -> None:
    doc = build_fallback_slide_document(
        title="T",
        subtitle="Sub",
        theme="default",
        body_inner="<ul><li>a</li></ul>",
    )
    assert "oaao-slide-canvas-lock" in doc
    assert "oaao-slide-canvas" in doc


def test_layout_render_varies_by_theme() -> None:
    from oaao_orchestrator.slide_project.layouts import infer_layout, render_layout_slide

    spec_hero = {"index": 1, "title": "Opening", "theme": "default"}
    assert infer_layout(spec_hero, slide_count=10) == "title_hero"
    doc = render_layout_slide(
        spec=spec_hero,
        deck_title="Deck",
        content_md="- Goal one\n- Goal two",
        slide_count=10,
    )
    assert "oaao-hero" in doc
    assert "oaao-layout-title_hero" in doc

    spec_cards = {"index": 4, "title": "Architecture", "theme": "platform_layers"}
    assert infer_layout(spec_cards, slide_count=10) == "three_cards"
    doc2 = render_layout_slide(
        spec=spec_cards,
        deck_title="Deck",
        content_md="### Layer A\n- One\n### Layer B\n- Two\n### Layer C\n- Three",
        slide_count=10,
    )
    assert "oaao-cards" in doc2


def test_diversify_layouts_no_adjacent_dupes() -> None:
    from oaao_orchestrator.slide_project.layout_plan import diversify_slide_layouts

    specs = [{"index": i, "title": f"Slide {i}", "theme": "default"} for i in range(1, 11)]
    specs[5]["title"] = "常見問題與錯誤排除 (FAQ)"
    specs[6]["title"] = "實戰案例分析"
    out = diversify_slide_layouts(specs)
    layouts = [str(s.get("layout") or "") for s in out]
    assert layouts[0] == "title_hero"
    assert layouts[-1] == "summary"
    assert layouts[5] == "faq_split"
    for i in range(1, len(layouts)):
        assert layouts[i] != layouts[i - 1]


def test_faq_split_layout_renders() -> None:
    from oaao_orchestrator.slide_project.layouts import render_layout_slide

    doc = render_layout_slide(
        spec={"index": 6, "title": "FAQ", "theme": "default", "layout": "faq_split"},
        deck_title="Handbook",
        content_md="- 問題一？\n- 問題二？\n- 答：做法 A\n- 答：做法 B",
        slide_count=10,
    )
    assert "oaao-faq-grid" in doc
    assert "Key point for slide" not in doc


def test_fallback_document_passes_html_validation() -> None:
    doc = build_fallback_slide_document(
        title="Vol.3",
        subtitle="Subtitle",
        theme="default",
        body_inner="<ul><li>一</li></ul>",
    )
    ok, errors = validate_slide_html(doc)
    assert ok is True
    assert errors == []
