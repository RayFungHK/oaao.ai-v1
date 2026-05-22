"""JSON template catalog loads and substitutes CSS tokens."""


def test_catalog_loads_layouts_and_themes() -> None:
    from oaao_orchestrator.slide_project.template_registry import (
        catalog_version,
        layout_content_recipe,
        layout_ids,
        theme_ids,
    )

    assert catalog_version() >= 1
    assert "three_cards" in layout_ids()
    assert "executive_problem" in theme_ids()
    assert "區塊" in layout_content_recipe("three_cards")


def test_build_layout_css_has_palette() -> None:
    from oaao_orchestrator.slide_project.template_registry import build_layout_css

    css = build_layout_css("default", "title_content", None)
    assert "#f8fafc" in css
    assert "1280px" in css


def test_diversify_reads_plan_json() -> None:
    from oaao_orchestrator.slide_project.layout_plan import diversify_slide_layouts

    specs = [{"index": i, "title": f"S{i}"} for i in range(1, 6)]
    specs[4]["title"] = "常見問題 FAQ"
    out = diversify_slide_layouts(specs)
    layouts = [s["layout"] for s in out]
    assert layouts[0] == "title_hero"
    assert layouts[-1] == "summary"
    assert layouts[4] == "faq_split"
