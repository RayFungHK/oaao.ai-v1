"""SearXNG language mapping from user / orientation preferences."""

from oaao_orchestrator.knowledge.search_language import (
    bcp47_to_searxng_language,
    resolve_searxng_language,
)


def test_bcp47_zh_hant_to_zh_tw() -> None:
    assert bcp47_to_searxng_language("zh-Hant") == "zh-TW"
    assert bcp47_to_searxng_language("zh-TW") == "zh-TW"


def test_bcp47_zh_hans_to_zh_cn() -> None:
    assert bcp47_to_searxng_language("zh-Hans") == "zh-CN"
    assert bcp47_to_searxng_language("zh-CN") == "zh-CN"


def test_bcp47_en_variants() -> None:
    assert bcp47_to_searxng_language("en") == "en"
    assert bcp47_to_searxng_language("en-US") == "en"


def test_resolve_prefers_display_over_orientation() -> None:
    assert (
        resolve_searxng_language(
            display_locale="zh-Hant",
            orientation_language="en",
        )
        == "zh-TW"
    )


def test_resolve_orientation_fallback() -> None:
    assert resolve_searxng_language(display_locale="", orientation_language="ja") == "ja"


def test_resolve_empty_returns_none() -> None:
    assert resolve_searxng_language() is None
