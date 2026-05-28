"""Crystallized skill recall must not override LLM planner routing."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.crystallization.recall import should_skip_crystallized_skill_recall


def test_skip_recall_for_composer_auto_source() -> None:
    req = SimpleNamespace(
        enable_web_search=False,
        vault_auto_rag=True,
        vault_source_refs=[],
        vault_source_ids=[],
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": "網絡上有沒有 DJI Pocket 4 Pro 開售消息？"}],
    )
    assert should_skip_crystallized_skill_recall(req) is True


def test_skip_recall_when_composer_web_search_on() -> None:
    req = SimpleNamespace(
        enable_web_search=True,
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": "hello"}],
    )
    assert should_skip_crystallized_skill_recall(req) is True


def test_allow_recall_for_wallet_style_fast_chat() -> None:
    req = SimpleNamespace(
        enable_web_search=False,
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": "之前是有記錄錢包的用法？"}],
    )
    assert should_skip_crystallized_skill_recall(req) is False
