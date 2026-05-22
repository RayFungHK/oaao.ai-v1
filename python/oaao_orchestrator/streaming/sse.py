"""Format Server-Sent Events with monotonic ``id`` for ``Last-Event-ID`` / ``since_seq`` resume."""

from __future__ import annotations

import json
from typing import Any


def encode_sse(*, seq_id: int, event_name: str, data: dict[str, Any]) -> str:
    body = json.dumps(data, ensure_ascii=False)
    return f"id: {seq_id}\nevent: {event_name}\ndata: {body}\n\n"
