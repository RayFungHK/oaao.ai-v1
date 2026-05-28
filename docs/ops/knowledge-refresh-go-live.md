# Knowledge refresh — go-live (T1)

Platform **Settings → Knowledge** drives scheduled bucket refresh. Env vars bootstrap until settings are saved.

## Prerequisites

| Item | Check |
|------|--------|
| PostgreSQL canonical | `oaao_tenant`, endpoints meta |
| `OAAO_ORCH_SHARED_SECRET` | Set in `docker/env` (PHP + orchestrator) |
| Orchestrator reachable | `OAAO_ORCHESTRATOR_INTERNAL_URL` from web |
| Platform operator | User can open **Settings → Knowledge** on platform host |

## Env (`docker/env.example`)

```bash
OAAO_ORCH_SHARED_SECRET=…
OAAO_VAULT_JOB_POLL_BASE_URL=http://web/vault/api   # enables orchestrator knowledge_cron_poll_loop
# OAAO_KNOWLEDGE_CRON_DISABLE=1
# OAAO_KNOWLEDGE_CRON_POLL_INTERVAL_SEC=3600
# OAAO_KNOWLEDGE_REFRESH_USER_ID=1
# OAAO_KNOWLEDGE_CRON_BASE_URL=http://127.0.0.1/endpoints/api
# OAAO_KNOWLEDGE_CRON_LOG_DIR=./var/log
```

## Platform UI

1. Log in as **platform operator** on platform tenant host.
2. **Settings → Knowledge** — enable scheduled refresh, interval, classify-after-capture, vault IDs (or run bootstrap once).
3. Save; confirm `knowledge.platform.*` purpose meta in DB.

Optional bootstrap API (platform-only):

`POST /endpoints/api/knowledge_platform_bootstrap`

## Manual cron tick

```bash
chmod +x scripts/oaao_knowledge_refresh_cron.sh
OAAO_ENV_FILE=./docker/env ./scripts/oaao_knowledge_refresh_cron.sh
# Force refresh (ignore staleness):
OAAO_ENV_FILE=./docker/env ./scripts/oaao_knowledge_refresh_cron.sh --force
```

Appends JSON response to `$OAAO_KNOWLEDGE_CRON_LOG_DIR/knowledge-refresh.log` (default `./var/log`).

## Compose / systemd

- **Recommended:** orchestrator `knowledge_cron_poll_loop` when `OAAO_VAULT_JOB_POLL_BASE_URL` is set (`docker-compose.yml`).
- **Optional sidecar:** `docker compose --profile knowledge-cron up -d knowledge-refresh-cron` — see `docker/knowledge-refresh-cron/README.md`.

## Logs

| Source | Where |
|--------|--------|
| Host script | `var/log/knowledge-refresh.log` |
| PHP tick | `error_log` line `[oaao knowledge_cron_run] …` |
| Orchestrator | `/v1/knowledge/refresh` worker logs |

## Smoke

1. `curl -fsS -X POST -H "X-OAAO-Internal-Token: $SECRET" -H "Content-Type: application/json" -d '{}' "$BASE/knowledge_cron_run" | jq .success`
2. Expect `success: true` or `skipped: true` with `reason` when schedule disabled.
3. With `force: true`, orchestrator should return `ok` in `orchestrator` payload.
