from oaao_orchestrator.research.summarize import (
    article_body_for_summary,
    normalize_summary_language,
    _extract_abstract_excerpt,
    _fallback_summary,
)


def test_normalize_summary_language_zh_hant_aliases() -> None:
    assert normalize_summary_language("zh-Hant") == "zh-hant"
    assert normalize_summary_language("zh-TW") == "zh-hant"
    assert normalize_summary_language("zh-HK") == "zh-hant"


def test_article_body_for_summary_strips_frontmatter() -> None:
    md = """---
title: Example Paper
source_url: https://arxiv.org/abs/1234.5678
content_url: https://arxiv.org/html/1234.5678v1
---

# Example Paper

## Abstract

This paper proposes a new method.
"""
    body = article_body_for_summary(md)
    assert "source_url:" not in body
    assert "content_url:" not in body
    assert "This paper proposes a new method." in body


def test_extract_abstract_excerpt() -> None:
    body = """## Introduction

Intro text.

## Abstract

Multi-shot video generation requires consistency across shots while staying faithful to prompts.
We propose EM-Vid, a training-free memory module.

## 1 Introduction

More text.
"""
    excerpt = _extract_abstract_excerpt(body)
    assert "EM-Vid" in excerpt
    assert "Multi-shot" in excerpt


def test_fallback_summary_uses_zh_hant_notice() -> None:
    md = """---
title: EM-Vid
source_url: https://arxiv.org/abs/2605.23610
---

# EM-Vid

## Abstract

Multi-shot video generation requires consistency.
"""
    result = _fallback_summary(md, language="zh-Hant", reason="test")
    assert result.mode == "fallback"
    assert "未使用 AI 摘要" in result.text
    assert "Multi-shot video generation" in result.text
    assert "source_url:" not in result.text
