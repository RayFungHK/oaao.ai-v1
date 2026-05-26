"""ACCS vault-grounded negative answer heuristics."""

from oaao_orchestrator.evaluation.accs import _heuristic_factors
from oaao_orchestrator.evaluation.pipeline_evidence import (
    looks_like_valid_vault_negative_answer,
)


def test_valid_vault_negative_answer_detected():
    user = "Vault 中的 research，沒有相關的 paper？"
    assistant = (
        "檢索 Vault 後，提供的文檔中**沒有**直接提到 KV Cache Compression。"
        "資料主要涵蓋 Automated Scientific Research 與 Knowledge Graphs。"
    )
    evidence = [
        {
            "file_name": "research.pdf",
            "excerpt": "Automated Scientific Research using LLMs and Knowledge Graphs.",
        },
    ]
    assert looks_like_valid_vault_negative_answer(
        user_message=user,
        llm_output=assistant,
        evidence=evidence,
    )


def test_heuristic_boosts_valid_vault_negative():
    user = "Vault 中的 research，沒有相關的 paper？"
    assistant = (
        "Vault 檢索結果顯示沒有相關 paper；文檔實際包含 Knowledge Graph 相關研究。"
    )
    evidence = [{"file_name": "a.pdf", "excerpt": "Knowledge Graph research overview."}]
    score, factors = _heuristic_factors(user, assistant, evidence)
    assert score >= 0.65
    assert factors["accuracy"] >= 0.85
    assert factors["alignment"] >= 0.85


def test_valid_vault_negative_not_fired_without_evidence():
    user = "Vault 有沒有 paper？"
    assistant = "沒有相關 paper。"
    assert not looks_like_valid_vault_negative_answer(
        user_message=user,
        llm_output=assistant,
        evidence=[],
    )
