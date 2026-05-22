from __future__ import annotations

from pathlib import Path

import pytest

from oaao_orchestrator.live_meeting.hub import create_session, stop_session
from oaao_orchestrator.live_meeting.session import LiveMeetingSession


@pytest.mark.asyncio
async def test_live_meeting_session_dirs(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    session = create_session(cadence="1v1", workspace_id=5, user_id=9)
    assert session.session_dir.is_dir()
    assert session.audio_dir.is_dir()
    assert session.meta_path.is_file()
    assert await stop_session(session.session_id, keep_audio=False)
    loaded = LiveMeetingSession.load(session.session_id, root=tmp_path)
    assert loaded is not None
    assert loaded.status == "stopped"
