# W8-S1 — Redis Queue Backend Rollout (Canary)

**Status:** ✅ Code shipped; canary opt-in via env. **Metrics + kill-switch land in W8-S3.**

## What changed

`oaao_orchestrator.queue_pool.QueuePool` now delegates all FIFO operations
to a `QueueBackend` Protocol (see W7-S2). Two backends ship in this batch:

| Backend | Activation | Default |
| --- | --- | --- |
| `MemoryQueueBackend` (asyncio.Queue) | Always | ✅ |
| `RedisStreamQueueBackend` (XADD/XREADGROUP/XACK) | `OAAO_QUEUE_BACKEND=redis` + `OAAO_QUEUE_REDIS_URL=...` | — |

If `OAAO_QUEUE_BACKEND=redis` is set but the `redis` package isn't installed
**or** `OAAO_QUEUE_REDIS_URL` is unset, the factory logs a warning and falls
back to the memory backend. Existing deployments are unaffected unless
explicitly opted in.

## Env contract

| Variable | Default | Meaning |
| --- | --- | --- |
| `OAAO_QUEUE_BACKEND` | `memory` | `redis` enables canary backend |
| `OAAO_QUEUE_REDIS_URL` | _(unset)_ | Required for redis backend; standard `redis://` URL |
| `OAAO_QUEUE_REDIS_STREAM_PREFIX` | `oaao:queue:` | Stream key = prefix + pool_id |
| `OAAO_QUEUE_REDIS_GROUP` | `oaao-orchestrator` | XGROUP name |
| `OAAO_QUEUE_REDIS_CONSUMER` | `<pool_id>-<pid>` | Per-process consumer name |
| `OAAO_QUEUE_MAX_SIZE` | `0` | W8-S2 — memory backend cap; 0 = unbounded |
| `OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP` | `0` | W8-S2 — total worker_number ceiling |

## Canary plan

1. **Stage 1 — single pool, single tenant.** Pick a low-volume pool
   (e.g., the `accs` post-stream pool). Set `OAAO_QUEUE_BACKEND=redis`
   for that orchestrator instance only. Verify XLEN matches expected depth.
2. **Stage 2 — observe 24h.** Track Redis stream length, XPENDING entries,
   and orchestrator restart count. Compare against the in-memory baseline
   (post-stream plugin latency p50/p95 from existing logs).
3. **Stage 3 — opt in a second instance** sharing the same group. Verify
   work distribution via `XINFO CONSUMERS <stream> <group>`.
4. **Stage 4 — promote to default** only after W8-S3 ships:
   - structured metrics (queue_depth, oldest_pending_age, xack_failures),
   - a runtime kill-switch (`OAAO_QUEUE_BACKEND=memory` hot reload via
     `start_post_stream_pools()` restart on SIGHUP).

## Rollback

- Set `OAAO_QUEUE_BACKEND=memory` (or unset) and restart the orchestrator.
- Pending Redis stream entries remain — drain by leaving one orchestrator
  instance pinned to `redis` until `XLEN == 0`, then unset.

## Known limitations (this batch)

- `RedisStreamQueueBackend.qsize()` returns `0` (advisory). Real depth via
  `XLEN`/`XPENDING` lands with metrics in W8-S3.
- No automatic dead-letter routing yet; failed plugin runs are logged but
  the stream entry is XACKed. W8-S3 will add a DLQ key.
- Backpressure (W8-S2) is enforced only on the memory backend. Redis is
  bounded by `MAXLEN ~ 10_000` (approximate trim) on writes.
