# W8-S3 — Redis queue canary rollout (Top-20 #8 ops)

**Status:** Code + metrics shipped (W8-S1/W8-S3). This doc is the **Stage 2–4 ops checklist** for promoting `OAAO_QUEUE_BACKEND=redis`.

## Prerequisites

- Redis reachable at `OAAO_QUEUE_REDIS_URL` (Compose service `redis` or external).
- `OAAO_QUEUE_POOLS_JSON` points at post-stream pool config.
- Baseline memory-backend metrics captured for 24h (`GET /v1/work_queues/status`).

## Stage 2 — 24h observe (single instance)

1. Set on **one** orchestrator replica only:
   ```bash
   OAAO_QUEUE_BACKEND=redis
   OAAO_QUEUE_REDIS_URL=redis://redis:6379/0
   ```
2. Monitor every 15m:
   - `queue_backend` in `/v1/work_queues/status` → `redis`
   - Redis `XLEN` / `XPENDING` for stream prefix `oaao:queue:post_stream_metrics`
   - `xack_failures` in work_queues payload
   - Post-stream IQS/ACCS latency (orchestrator logs / ACCS upsert timestamps)
3. **Rollback trigger:** `xack_failures` rising, stream depth monotonic for >30m, or ACCS/IQS stall >10m.
4. **Rollback:** `OAAO_QUEUE_BACKEND=memory` + `docker compose restart orchestrator` (or SIGHUP reload per W8-S3).

## Stage 3 — second consumer (work distribution)

1. Enable redis backend on a **second** orchestrator with same `OAAO_QUEUE_REDIS_GROUP`.
2. Verify `XINFO CONSUMERS` shows both consumer names (`{pool_id}-{pid}`).
3. Confirm no duplicate turn_score upserts (idempotent PHP merge).

## Stage 4 — promote default

1. Set `OAAO_QUEUE_BACKEND=redis` in `docker/env.stage.example` / production env tier.
2. Keep kill-switch documented: `OAAO_QUEUE_KILL_SWITCH=1` stops enqueue; SIGHUP reloads pools.
3. Drain legacy memory queues before removing memory-only caps.

## Runbook cross-links

- Metrics/kill-switch: [queue_metrics.py](../python/oaao_orchestrator/queue_metrics.py), [post_stream_pool.py](../python/oaao_orchestrator/post_stream_pool.py)
- Architecture rollback: [W12_S1_Architecture_Runbook_Rollback.md](W12_S1_Architecture_Runbook_Rollback.md)
- Load test gate: [W13_S1_LoadTest_GoNoGo.md](W13_S1_LoadTest_GoNoGo.md)
