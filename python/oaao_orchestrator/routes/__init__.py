"""W5-S1 — orchestrator route modularisation.

Phase 1 deliverable: each cohesive route group lives in its own submodule,
mounted from `app.py` via `app.include_router(...)`. The router modules MUST
NOT import from `app.py` (one-way dependency); shared helpers (e.g. internal-
token guard) live in `oaao_orchestrator.routes._deps`.

Mounted so far:
- routes.health  — liveness probe
- routes.admin   — `/v1/admin/*` (evolution patches, reports, crystallization)
- routes.mine    — `/v1/mine/*` (run + discover; W5-S1 phase 2)
- routes.research — `/v1/research/*` (run + match + discover trio; W5-S1 phase 2)
- routes.live    — `/v1/live/*` (session lifecycle + WS audio + SSE; W5-S1 phase 3)
- routes.runs    — `/v1/runs/{id}/agent_ask|cancel` + `/v1/stream` (W5-S1 phase 4)
- routes.slides  — `/v1/slides/*` (slide-project + custom-template lifecycle; W5-S1 phase 4)
- routes.turn_scores — `/v1/turn_scores/*` + `/v1/work_queues/status` (W5-S1 phase 5)
- routes.asr     — `/v1/asr/transcribe` + `/v1/funasr/{ensure,status}` (W5-S1 phase 6)

Pending phase-2 candidates (do not block W5-S1 acceptance):
- `/v1/runs/chat`  — follows after run_executor LLM-stream loop is extracted
"""

from __future__ import annotations

from oaao_orchestrator.routes.admin import router as admin_router
from oaao_orchestrator.routes.asr import router as asr_router
from oaao_orchestrator.routes.health import router as health_router
from oaao_orchestrator.routes.live import router as live_router
from oaao_orchestrator.routes.mine import router as mine_router
from oaao_orchestrator.routes.research import router as research_router
from oaao_orchestrator.routes.runs import router as runs_router
from oaao_orchestrator.routes.slides import router as slides_router
from oaao_orchestrator.routes.turn_scores import router as turn_scores_router

__all__ = [
    "admin_router",
    "asr_router",
    "health_router",
    "live_router",
    "mine_router",
    "research_router",
    "runs_router",
    "slides_router",
    "turn_scores_router",
]
