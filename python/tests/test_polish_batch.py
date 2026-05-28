"""Polish regression batch — quick rules + LLM assess (optional live)."""

from __future__ import annotations

import os

import httpx
import pytest

from oaao_orchestrator.asr_common import (
    build_polish_user_content,
    polish_transcript,
)
from oaao_orchestrator.polish_assess import (
    POLISH_BATCH_SAMPLES,
    assess_llm_polish,
    assess_quick_polish,
    is_substantive_llm_polish,
    polish_weak_output,
    score_polish_quality,
)

USER_SAMPLE = (
    "我想知道 ai 入边嘅 llm 系乜嘢？，意思 kv 系乜理权重系乜理，"
    "同埋点样可以学习。"
)


@pytest.mark.parametrize("sample", POLISH_BATCH_SAMPLES, ids=[s["id"] for s in POLISH_BATCH_SAMPLES])
def test_quick_polish_batch_no_artifacts(sample: dict) -> None:
    result = assess_quick_polish(sample["raw"])
    assert result.passed, result.failed


def test_user_regression_sample_quick() -> None:
    result = assess_quick_polish(USER_SAMPLE)
    assert "\\1" not in result.polished
    assert result.checks[0].passed


def test_llm_prompt_is_minimal_one_liner() -> None:
    content = build_polish_user_content(
        raw=USER_SAMPLE,
        locale="zh-Hant",
        polish_style="professional",
    )
    assert "ASR polish expert" in content
    assert "formal style" in content
    assert "zh-Hant" in content
    assert USER_SAMPLE in content
    assert "Return only the polished text" in content


def test_assess_llm_rejects_unchanged_colloquial() -> None:
    """Simulates false 'LLM polished' — same colloquial text as screenshot."""
    fake = USER_SAMPLE
    result = assess_llm_polish(USER_SAMPLE, fake, locale="zh-Hant", style="professional")
    assert not result.passed
    assert any(c.name == "not_unchanged_colloquial" and not c.passed for c in result.checks)


def test_substantive_llm_polish_rejects_screenshot_case() -> None:
    assert not is_substantive_llm_polish(USER_SAMPLE, USER_SAMPLE, locale="zh-Hant")


def test_score_polish_quality_caps_unchanged_colloquial() -> None:
    score = score_polish_quality(USER_SAMPLE, USER_SAMPLE, locale="zh-Hant")
    assert score <= 25


def test_score_polish_quality_semantic_not_diff_length() -> None:
    """Good written polish scores high even when length is close to raw."""
    good = (
        "我想了解 AR 中的 M 權重以及 KFR 是什麼意思，"
        "以及有哪些書籍可以教我如何使用這些人工智慧技術？"
    )
    score = score_polish_quality(USER_SAMPLE, good, locale="zh-Hant")
    assert score >= 75


def test_score_polish_quality_quick_punctuate_stays_low() -> None:
    quick = assess_quick_polish(USER_SAMPLE).polished
    score = score_polish_quality(USER_SAMPLE, quick, locale="zh-Hant")
    assert score <= 40


def test_polish_weak_output_flags_user_regression_sample() -> None:
    assert polish_weak_output(USER_SAMPLE, USER_SAMPLE, locale="zh-Hant")


def test_assess_llm_accepts_good_professional_example() -> None:
    good = (
        "我想了解 AI 中的大型語言模型（LLM）是什麼？"
        "KV Cache（鍵值緩存）是什麼？權重（Weights）是什麼？"
        "我應該如何學習這些知識？"
    )
    result = assess_llm_polish(USER_SAMPLE, good, locale="zh-Hant", style="professional")
    assert result.passed, result.failed


def _live_polish_configured() -> bool:
    base = (os.environ.get("OAAO_POLISH_TEST_BASE_URL") or os.environ.get("OAAO_POLISH_BASE_URL") or "").strip()
    model = (os.environ.get("OAAO_POLISH_TEST_MODEL") or os.environ.get("OAAO_POLISH_MODEL") or "").strip()
    return bool(base and model)


@pytest.mark.asyncio
@pytest.mark.parametrize("sample", POLISH_BATCH_SAMPLES, ids=[s["id"] for s in POLISH_BATCH_SAMPLES])
async def test_live_llm_polish_batch(sample: dict) -> None:
    if not _live_polish_configured():
        pytest.skip("Set OAAO_POLISH_TEST_BASE_URL + OAAO_POLISH_TEST_MODEL for live LLM batch")

    base = os.environ["OAAO_POLISH_TEST_BASE_URL"].strip().rstrip("/")
    model = os.environ["OAAO_POLISH_TEST_MODEL"].strip()
    cfg: dict = {
        "base_url": base,
        "model": model,
        "locale": sample.get("locale", "zh-Hant"),
        "display_locale": sample.get("locale", "zh-Hant"),
        "polish_style": sample.get("style", "natural"),
        "timeout_sec": float(os.environ.get("OAAO_POLISH_TEST_TIMEOUT_SEC", "15")),
    }
    api_key = (os.environ.get("OAAO_POLISH_TEST_API_KEY") or "").strip()
    if api_key:
        cfg["api_key_env"] = "__pytest_polish_key__"
        os.environ["__pytest_polish_key__"] = api_key

    async with httpx.AsyncClient() as client:
        polished, err = await polish_transcript(
            client,
            raw_text=sample["raw"],
            polish_cfg=cfg,
        )

    assert polished, f"empty polish output (err={err})"
    result = assess_llm_polish(
        sample["raw"],
        polished,
        locale=sample.get("locale", "zh-Hant"),
        style=sample.get("style", "natural"),
    )
    assert result.passed, result.failed
