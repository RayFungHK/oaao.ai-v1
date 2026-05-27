# W8-S2 — Vault job worker unification (Top-20 #9 phase 1)

**Status:** Phase 1 shipped — PG-native claim path, shared dispatch module, adaptive idle backoff, contract adapter.

## What changed

| Area | Before | After |
|------|--------|-------|
| Hook dispatch | Inline in `vault_job_poll.py` | [vault_job_dispatch.py](../python/oaao_orchestrator/vault_job_dispatch.py) |
| Empty-queue sleep | Fixed `OAAO_VAULT_JOB_POLL_INTERVAL_SEC` | Exponential backoff via [vault_job_idle.py](../python/oaao_orchestrator/vault_job_idle.py) |
| Contract mapping | Schema only in `contracts/v1/` | [vault_job_contract.py](../python/oaao_orchestrator/vault_job_contract.py) + tests |

## Env (recommended Compose)

```bash
OAAO_VAULT_JOB_CLAIM_MODE=pg          # skip HTTP vault_job_claim when OAAO_PG_URL set
OAAO_VAULT_JOB_POLL_INTERVAL_SEC=4    # base for idle backoff cap
```

Finish still posts to PHP `vault_job_finish` (side effects / chaining unchanged).

## Phase 2 (deferred)

- Browser SSE: `GET /v1/vault/ingest/stream` replacing `vault-panel.js` 3s poll
- Redis stream consumer sharing `QueueBackend` with post-stream pools
- PG `NOTIFY oaao_vault_job` wake (eliminate idle poll latency)

## Verification

```bash
docker compose exec orchestrator python -m pytest \
  python/tests/test_vault_job_poll_helpers.py \
  python/tests/test_subprocess_pool_w9s1.py -q
```
