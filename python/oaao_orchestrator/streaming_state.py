"""W5-S1 phase 4 — Shared run-streaming state.

Holds the process-global ``StreamSessionRegistry`` and the per-run
``_stream_tokens`` dict, formerly module-level in ``app.py``. Extracted so
``routes/runs.py`` (and any future router that consumes streaming state)
can import them without creating an import cycle with ``app.py``.

This module is intentionally tiny and side-effect-free apart from the two
process-global singletons — same lifetime as the FastAPI app process.
"""

from __future__ import annotations

from oaao_orchestrator.streaming.session import StreamSessionRegistry

# Process-global registry of active chat runs (one entry per run_id).
registry: StreamSessionRegistry = StreamSessionRegistry()

# Per-run stream tokens minted in ``/v1/runs/chat`` and consumed by
# ``/v1/stream`` (subscribe_stream). Compared with ``secrets.compare_digest``.
_stream_tokens: dict[str, str] = {}
