# W13-S1 — Load Test, Rollback & Go/No-Go

## 1. Scope

Validate that the 90-day commercialization release is production-ready under the published SLOs.

## 2. SLOs to hit

| Metric | Target | Source |
| --- | --- | --- |
| `/v1/runs/chat` p95 (token first-byte) | ≤ 1500 ms | orchestrator logs |
| `/v1/runs/chat` p99 first-byte | ≤ 2500 ms | — |
| `/v1/stream` SSE 5xx rate | ≤ 0.1% | nginx access logs |
| Post-stream queue depth (steady-state) | ≤ `OAAO_QUEUE_MAX_SIZE × 0.5` | `/v1/admin/profiling` + `caches_snapshot()` |
| Vault upload→OCR ready p95 | ≤ 60 s | `vault_job_poll` logs |
| Internal-token rejection (`bad_internal_token`) | 0 in 1h | orchestrator logs |
| ASR streaming gap | ≤ 200 ms p95 | `live_meeting/hub` logs |

## 3. Load profiles

Two profiles, both driven by **k6** (preferred) or **Locust**:

### 3.1 Baseline soak
- 20 concurrent chat sessions, 30-message rounds, 30 minutes.
- 5 concurrent vault uploads / minute (50 MB PDF mix).
- 2 live ASR sessions, 5 minutes each.

### 3.2 Stress burst
- 200 chat sessions ramped over 60 s, hold 5 min.
- Post-stream pool depth verified to stay ≤ cap; backpressure (`try_enqueue → False`) acceptable; HTTP 5xx unacceptable.
- 50 vault uploads in 60 s — expect 202s + async polling.

## 4. Test environment

- **Staging** mirrors prod sizing (1 orchestrator pod + 1 Razy pod + 1 Redis + 1 MariaDB).
- Redis backend canary enabled at 50% via `OAAO_QUEUE_BACKEND=redis` on one of two orchestrator replicas.
- Profiling on: `OAAO_PROFILING_ENABLED=1`.

## 5. Go/No-Go checklist

| Gate | Pass criterion | Owner |
| --- | --- | --- |
| All SLOs in §2 met during both load profiles | ✓ | SRE |
| Zero unhandled exceptions in orchestrator + Razy error logs | ✓ | Backend |
| Contract tests green ([test_contracts_v1.py](../python/tests/test_contracts_v1.py), [test_errors_contract.py](../python/tests/test_errors_contract.py)) | ✓ | Backend |
| Rotation drill executed in staging within 14 days | ✓ | SRE — see [W11_S1_SecretsRotationDrill.md](W11_S1_SecretsRotationDrill.md) |
| Rollback path validated for at least one change class | ✓ | SRE — see [W12_S1_Architecture_Runbook_Rollback.md](W12_S1_Architecture_Runbook_Rollback.md) §3 |
| Top-20 P0 items closed or have approved waiver | ✓ | Product |

## 6. Rollback rehearsal (mandatory before prod)

1. Deploy current release to staging.
2. Run §3.1 baseline soak.
3. Mid-run, trigger rollback per §3 row 1 of [W12_S1_Architecture_Runbook_Rollback.md](W12_S1_Architecture_Runbook_Rollback.md).
4. Verify recovery within stated RTO; no data loss in queue (Redis canary should still flush XPENDING entries on the surviving consumer).
5. Document outcome in the release ticket; attach k6 summary JSON.

## 7. Reporting

Each load run produces:
- `loadtest/<date>/k6-summary.json`
- `loadtest/<date>/orch-profiling.json` (snapshot of `/v1/admin/profiling`)
- `loadtest/<date>/queue-depth.csv` (sampled every 5 s)

Append the 30-day trend to [W1_S2_Baseline_KPI.md](W1_S2_Baseline_KPI.md) as the new KPI ceiling.
