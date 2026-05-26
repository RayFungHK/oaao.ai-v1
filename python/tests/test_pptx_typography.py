"""PPTX locale + typography hints (import analyze P0)."""

from __future__ import annotations

from oaao_orchestrator.slide_project.pptx_typography import (
    apply_typography_to_deck_style,
    build_typography_hints,
    detect_locale,
)


def test_detect_locale_zh_hant() -> None:
    text = "為什麼現在需要這個平台？管理層關心的不是功能列表，而是可信度。"
    loc = detect_locale(text)
    assert loc["primary"] in ("zh-Hant", "zh-Hans")
    assert loc["script_mix"] in ("cjk_primary", "zh_latin_mixed")
    assert loc["confidence"] >= 0.5


def test_detect_locale_english() -> None:
    text = "Executive briefing for management. KPI metrics and governance framework."
    loc = detect_locale(text)
    assert loc["primary"] == "en"
    assert loc["script_mix"] == "latin_primary"


def test_build_typography_hints_cjk_mismatch() -> None:
    locale = {"primary": "zh-Hant", "script_mix": "cjk_primary", "confidence": 0.9}
    fonts = {
        "used_typefaces": ["Arial", "Calibri"],
        "theme_major": "Calibri Light",
        "theme_minor": "Calibri",
    }
    hints = build_typography_hints(locale, fonts)
    assert "Noto Sans TC" in hints["recommended_stack"] or "JhengHei" in hints["recommended_stack"]
    assert hints.get("locale_font_mismatch")
    assert "Arial" in hints.get("avoid_typefaces", [])


def test_apply_typography_to_deck_style_overrides_llm_latin() -> None:
    profile = {
        "locale": {"primary": "zh-Hant", "script_mix": "cjk_primary"},
        "typography_hints": build_typography_hints(
            {"primary": "zh-Hant", "script_mix": "cjk_primary"},
            {"used_typefaces": ["Arial"]},
        ),
    }
    deck = apply_typography_to_deck_style(
        {"typography": {"font_stack": "Arial, Helvetica, sans-serif"}},
        profile,
        llm_typography={"font_stack": "Arial, Helvetica, sans-serif"},
    )
    stack = str(deck["typography"]["font_stack"])
    assert stack != "Arial, Helvetica, sans-serif" or "Noto" in stack or "JhengHei" in stack
    assert deck["typography"]["primary_locale"] == "zh-Hant"


def test_apply_typography_principles_include_locale() -> None:
    profile = {
        "locale": {"primary": "zh-Hant"},
        "typography_hints": build_typography_hints(
            {"primary": "zh-Hant", "script_mix": "cjk_primary"},
            {"used_typefaces": ["Microsoft JhengHei"]},
        ),
    }
    deck = apply_typography_to_deck_style({}, profile)
    principles = deck.get("design_principles") or []
    assert any("zh-Hant" in str(p) for p in principles)
