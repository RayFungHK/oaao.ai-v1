from oaao_orchestrator.asr_common import (
    build_polish_system_prompt,
    build_polish_user_content,
    build_polish_user_task,
    extract_polish_llm_content,
    merge_asr_transcripts_for_polish,
    normalize_polish_locale,
    normalize_polish_style,
    polish_locale_label,
)


def test_normalize_polish_locale_zh_hant() -> None:
    assert normalize_polish_locale("zh-Hant") == "zh-Hant"
    assert normalize_polish_locale("zh-TW") == "zh-Hant"
    assert normalize_polish_locale("zh-HK") == "zh-Hant"


def test_normalize_polish_locale_zh_hans() -> None:
    assert normalize_polish_locale("zh-CN") == "zh-Hans"
    assert normalize_polish_locale("zh") == "zh-Hans"


def test_polish_locale_label_canonical_tag() -> None:
    assert polish_locale_label("zh-Hant") == "zh-Hant"
    assert polish_locale_label("en") == "en"


def test_build_polish_system_prompt_is_minimal() -> None:
    """System prompt is empty by design — task lives in the user message."""
    assert build_polish_system_prompt(locale="zh-Hant") == ""
    assert build_polish_system_prompt(locale="en") == ""


def test_build_polish_system_prompt_passes_through_extra() -> None:
    assert build_polish_system_prompt(locale="zh-Hant", system_extra="hello") == "hello"


def test_build_polish_user_task_is_one_liner() -> None:
    task = build_polish_user_task("zh-Hant", polish_style="professional")
    assert "ASR polish expert" in task
    assert "formal style" in task
    assert "zh-Hant" in task
    assert "Only return the polished content" in task
    assert "follow content" in task


def test_build_polish_user_task_style_words() -> None:
    assert "natural style" in build_polish_user_task("zh-Hant", polish_style="natural")
    assert "concise style" in build_polish_user_task("zh-Hant", polish_style="concise")
    assert "formal style" in build_polish_user_task("en", polish_style="professional")


def test_build_polish_user_content_quotes_transcript() -> None:
    content = build_polish_user_content(
        raw="我想知道 llm 系乜",
        locale="zh-Hant",
        polish_style="natural",
    )
    assert '"我想知道 llm 系乜"' in content
    assert "ASR polish expert" in content


def test_build_polish_user_content_includes_glossary() -> None:
    content = build_polish_user_content(
        raw="hello",
        locale="en",
        polish_style="natural",
        gloss_blob='{"foo":"bar"}',
    )
    assert "Glossary JSON:" in content
    assert "foo" in content


def test_normalize_polish_style_defaults_to_natural() -> None:
    assert normalize_polish_style(None) == "natural"
    assert normalize_polish_style("invalid") == "natural"
    assert normalize_polish_style("professional") == "professional"


def test_merge_asr_transcripts_prefers_longer_live() -> None:
    batch = "我想知道 ai 入邊嘅 llm"
    live = ["我想知道 ai 入邊嘅 llm 系乜", "系乜嘢嚟"]
    merged = merge_asr_transcripts_for_polish(
        asr_text=batch,
        batch_chunks=[batch],
        live_chunks=live,
    )
    assert len(merged) >= len(batch)


def test_extract_polish_llm_content_single_paragraph() -> None:
    raw = (
        "版本 1：專業正式版\n"
        "我想了解 LLM 內部的 KV Cache 與權重是什麼？"
    )
    out = extract_polish_llm_content(raw)
    assert "版本" not in out
    assert "KV Cache" in out
