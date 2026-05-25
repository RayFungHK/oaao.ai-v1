# OAAO evolution systemd timers

Schedule **daily report** and **weekly auto-apply** against the orchestrator sidecar (`/v1/admin/evolution/*`).

## Prerequisites

- Docker stack running with `orchestrator` reachable at `OAAO_ORCHESTRATOR_INTERNAL_URL` (see `docker/env`).
- `OAAO_ORCH_SHARED_SECRET` set in `docker/env` (same value PHP and orchestrator use).

## Install (Linux host)

Adjust `/opt/oaao` to your deployment path.

```bash
sudo cp scripts/systemd/oaao-evolution-daily.service /etc/systemd/system/
sudo cp scripts/systemd/oaao-evolution-daily.timer /etc/systemd/system/
sudo cp scripts/systemd/oaao-evolution-weekly.service /etc/systemd/system/
sudo cp scripts/systemd/oaao-evolution-weekly.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now oaao-evolution-daily.timer
sudo systemctl enable --now oaao-evolution-weekly.timer
```

## Manual run

```bash
chmod +x scripts/oaao_evolution_cron.sh
OAAO_ENV_FILE=./docker/env ./scripts/oaao_evolution_cron.sh daily
OAAO_ENV_FILE=./docker/env ./scripts/oaao_evolution_cron.sh weekly
```

Or from **Settings → Skills & tools** in the admin UI (triggers the same endpoints via PHP).

## Verify

```bash
systemctl list-timers | grep oaao-evolution
journalctl -u oaao-evolution-daily.service -n 20
```

## Schedule

| Timer | UTC | Endpoint |
|-------|-----|----------|
| `oaao-evolution-daily.timer` | Every day 00:30 | `POST /v1/admin/evolution/daily_report` |
| `oaao-evolution-weekly.timer` | Sunday 00:30 | `POST /v1/admin/evolution/weekly_apply` |
