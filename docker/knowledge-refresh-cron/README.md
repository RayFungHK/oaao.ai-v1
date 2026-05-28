# Knowledge refresh cron (WS-1-S5 / WS-1-S6)

Optional sidecar that ticks **Settings → Knowledge** scheduled refresh on an interval.

## Recommended: orchestrator poll (default in Compose)

When `OAAO_VAULT_JOB_POLL_BASE_URL` is set on the **orchestrator** service, `knowledge_cron_poll_loop` in the sidecar calls:

`POST {base}/endpoints/api/knowledge_cron_run`

with `X-OAAO-Internal-Token: OAAO_ORCH_SHARED_SECRET`. PHP reads **Settings → Knowledge** (`knowledge.platform.*` meta) and forwards to `POST /v1/knowledge/refresh`.

Env (see `docker/env.example`):

- `OAAO_KNOWLEDGE_CRON_POLL_INTERVAL_SEC` — poll cadence (default `3600`)
- `OAAO_KNOWLEDGE_CRON_DISABLE=1` — disable poll loop
- `OAAO_KNOWLEDGE_REFRESH_USER_ID` — user id for Vault ingest on promotion

## Optional: standalone curl sidecar

Enable Compose profile `knowledge-cron`:

```bash
docker compose --profile knowledge-cron up -d knowledge-refresh-cron
```

Or run on the host / systemd (like evolution cron):

```bash
chmod +x scripts/oaao_knowledge_refresh_cron.sh
OAAO_ENV_FILE=./docker/env ./scripts/oaao_knowledge_refresh_cron.sh
# Force immediate refresh (ignores orientation staleness in orchestrator):
OAAO_ENV_FILE=./docker/env ./scripts/oaao_knowledge_refresh_cron.sh --force
```

## Administrator UI

**Settings → Knowledge** — refresh interval, enable/disable schedule, classify after capture, RAG merge opt-out, `do_not_search` topics.

Purpose slot: `knowledge.platform.*` (meta `knowledge_refresh`).
