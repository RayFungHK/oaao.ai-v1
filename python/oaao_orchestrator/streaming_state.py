"""W5-S1 phase 4 / W10-S3 — Shared run-streaming state.

Holds the process-global ``StreamSessionRegistry`` and the per-run
``StreamTokenStore``, formerly a raw dict in ``app.py``. Extracted so
``routes/runs.py`` can import them without creating an import cycle.
"""

from __future__ import annotations

from oaao_orchestrator.stream_token import StreamTokenStore
from oaao_orchestrator.streaming.session import StreamSessionRegistry

# Process-global registry of active chat runs (one entry per run_id).
registry: StreamSessionRegistry = StreamSessionRegistry()

# Per-run stream tokens minted in ``/v1/runs/chat`` and consumed by ``/v1/stream``.
stream_tokens: StreamTokenStore = StreamTokenStore()

# Back-compat alias — prefer ``stream_tokens`` in new code.
_stream_tokens = stream_tokens
