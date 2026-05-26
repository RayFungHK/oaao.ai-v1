"""Fork CIT/CMT handoff compaction."""

from oaao_orchestrator.evaluation.fork_cit_cmt import heuristic_fork_handoff


def test_heuristic_fork_handoff_excludes_seed_from_body():
    msgs = [
        {"role": "user", "content": "Vault 中有沒有 KV cache 相關 paper？"},
        {"role": "assistant", "content": "檢索後沒有找到 KV cache 相關內容。"},
    ]
    out = heuristic_fork_handoff(
        recent_messages=msgs,
        seed_prompt="請重新聚焦我的問題",
        locale_hint="Vault",
    )
    body = str(out.get("compacted_content") or "")
    assert "較早對話" in body or "最近對話" in body
    assert "上文承接" not in body
    assert "請重新聚焦" not in body


def test_normalize_handoff_skips_ordered_list_hashes():
    from oaao_orchestrator.evaluation.fork_cit_cmt import normalize_handoff_markdown

    raw = "結論：\n# 1. 科研自動化"
    fixed = normalize_handoff_markdown(raw)
    assert "# 1." in fixed
    assert fixed.count("\n#\n") == 0
