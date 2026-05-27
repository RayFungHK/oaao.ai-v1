# OAAO load test scaffold (W13-S1)

k6 scripts for the [W13 go/no-go gate](../docs/W13_S1_LoadTest_GoNoGo.md).

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed locally
- Orchestrator reachable (default `http://127.0.0.1:8103` or staging URL)
- `OAAO_ORCH_SHARED_SECRET` set (same as `docker/env`)

Optional for real LLM runs:

```bash
export OAAO_CHAT_ENDPOINT_URL=https://your-llm/v1
export OAAO_CHAT_MODEL=your-model
```

## Profiles

| Script | Profile | Default load |
|--------|---------|--------------|
| `k6/baseline-soak.js` | §3.1 baseline soak | 20 VUs × 30m |
| `k6/stress-burst.js` | §3.2 stress burst | 200 VUs ramp 60s + hold 5m |

## Quick run

```bash
export OAAO_ORCH_SHARED_SECRET=your_secret
export OAAO_ORCHESTRATOR_URL=http://127.0.0.1:8103

# Full wrapper (writes loadtest/<date>/ artifacts)
bash scripts/run_loadtest_k6.sh baseline-soak
bash scripts/run_loadtest_k6.sh stress-burst

# Or direct k6
k6 run loadtest/k6/baseline-soak.js
```

## Artifacts (per run)

`scripts/run_loadtest_k6.sh` creates:

- `loadtest/<YYYY-MM-DD>/k6-<profile>-summary.json`
- `loadtest/<YYYY-MM-DD>/orch-profiling.json`
- `loadtest/<YYYY-MM-DD>/queue-depth.csv` (background sampler)

Dated output directories are gitignored; scripts in `loadtest/k6/` are committed.

## Redis canary Stage 2

Enable before soak on staging:

```bash
bash scripts/redis_canary_stage2_enable.sh
bash scripts/redis_canary_monitor.sh --interval 900 --duration 86400
```

Windows: `.\scripts\redis_canary_stage2_enable.ps1`

Rollback: `bash scripts/redis_canary_stage2_enable.sh --rollback`
