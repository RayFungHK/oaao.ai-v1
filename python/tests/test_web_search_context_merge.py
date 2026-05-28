"""Web search agent — context merge must update run_ctx.messages."""

from __future__ import annotations

from oaao_orchestrator.vault_rag.messages import inject_system_message


def test_web_search_merge_updates_messages_in_place() -> None:
    """Regression: inject into list(ctx.messages) copy left LLM without web hits."""
    ctx_messages = [{"role": "user", "content": "2026年5月大事"}]
    hits = [
        {
            "title": "May 2026 events",
            "url": "https://example.com/may-2026",
            "snippet": "Sample snippet",
        }
    ]
    lines = ["--- Web search results ---"]
    for i, h in enumerate(hits, start=1):
        lines.append(f"[W{i}] {h.get('title', '')} — {h.get('url', '')}\n{h.get('snippet', '')}")

    msgs = list(ctx_messages)
    inject_system_message(msgs, "\n\n".join(lines))
    ctx_messages_ref = msgs

    assert ctx_messages_ref[0]["role"] == "system"
    assert "Web search results" in str(ctx_messages_ref[0]["content"])
    assert "[W1]" in str(ctx_messages_ref[0]["content"])
    assert "May 2026 events" in str(ctx_messages_ref[0]["content"])
