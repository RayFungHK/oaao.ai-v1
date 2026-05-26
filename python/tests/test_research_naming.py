"""Research article title and filename slug resolution."""

from oaao_orchestrator.research.naming import (
    filename_slug,
    is_weak_title,
    resolve_article_title,
    title_from_markdown,
)

SYMNOISE_MD = """---
title: SymNoise: Advancing Language Model Fine-tuning with Symmetric Noise
source_url: https://arxiv.org/abs/2312.01523
---

# SymNoise: Advancing Language Model Fine-tuning with Symmetric Noise

## 1 Introduction
"""


def test_is_weak_title() -> None:
    assert is_weak_title("Introduction")
    assert is_weak_title("article")
    assert not is_weak_title("SymNoise: Advancing Language Model Fine-tuning with Symmetric Noise")


def test_title_from_markdown_prefers_frontmatter() -> None:
    assert "SymNoise" in title_from_markdown(SYMNOISE_MD)


def test_resolve_article_title_ignores_generic_html_title() -> None:
    title = resolve_article_title(
        "Introduction",
        title_hint="SymNoise paper",
        url="https://arxiv.org/abs/2312.01523",
        markdown=SYMNOISE_MD,
    )
    assert "SymNoise" in title


def test_filename_slug_includes_arxiv_id() -> None:
    slug = filename_slug("Introduction", "https://arxiv.org/abs/2312.01523")
    assert slug == "arxiv-2312-01523"

    slug2 = filename_slug(
        "SymNoise: Advancing Language Model Fine-tuning with Symmetric Noise",
        "https://arxiv.org/abs/2312.01523",
    )
    assert "symnoise" in slug2
    assert "2312" in slug2
    assert "01523" in slug2
