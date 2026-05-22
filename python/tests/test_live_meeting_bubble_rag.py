from __future__ import annotations

import pytest

from oaao_orchestrator.live_meeting.bubble_rag import lookup_bubble_vault


@pytest.mark.asyncio
async def test_lookup_bubble_vault_empty_query() -> None:
    out = await lookup_bubble_vault('', vault_retrieval_profiles=[])
    assert out['materials'] == []
    assert out['passage_count'] == 0
