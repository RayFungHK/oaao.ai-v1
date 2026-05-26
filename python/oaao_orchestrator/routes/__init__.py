"""W5-S1 — orchestrator route modularisation.

Phase 1 deliverable: each cohesive route group lives in its own submodule,
mounted from `app.py` via `app.include_router(...)`. The router modules MUST
NOT import from `app.py` (one-way dependency); shared helpers (e.g. internal-
token guard) live in `oaao_orchestrator.routes._deps`.

Mounted so far:
- routes.health  — liveness probe
- routes.admin   — `/v1/admin/*` (evolution patches, reports, crystallization)
- routes.mine    — `/v1/mine/*` (run + discover; W5-S1 phase 2)

Pending phase-2 candidates (do not block W5-S1 acceptance):
- routes.slides    (`/v1/slides/*`)         — ~500 LOC
- routes.research  (`/v1/research/*`)       — ~150 LOC
- routes.live      (`/v1/live/*`)           — ~250 LOC + WebSocket
- routes.runs      (`/v1/runs/*`)           — touches streaming, last to move
"""

from __future__ import annotations

from oaao_orchestrator.routes.admin import router as admin_router
from oaao_orchestrator.routes.health import router as health_router
from oaao_orchestrator.routes.mine import router as mine_router

__all__ = ["admin_router", "health_router", "mine_router"]
