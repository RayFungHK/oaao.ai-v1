# W1-S2 — Baseline KPI Dashboard

> Owner: `devops` · Cadence: daily snapshot via [scripts/kpi_snapshot.sh](../scripts/kpi_snapshot.sh) → `docs/kpi/YYYY-MM-DD.json`
> Consumers: cto (weekly), qa-lead (per-PR perf gate from W12-S1), security-lead (vuln trend).

## 1. KPI catalogue

| KPI | Definition | Source | Snapshot field | W12 target |
|---|---|---|---|---|
| **err_rate_5xx** | Fraction of orchestrator HTTP responses with status ≥ 500 over a rolling 24h window | `python/oaao_orchestrator/metrics.py` counters (Prom-style) — fallback: nginx access log `awk` | `error_rate.http_5xx_24h` | ≤ 0.5 % |
| **err_rate_ws_4xxx** | WebSocket 4xxx app-level closes / total connections, 24h | orchestrator structured logs (`ws.close_code`) | `error_rate.ws_4xxx_24h` | ≤ 2.0 % |
| **p95_chat_ttfb_ms** | P95 of `/chat/run` time-to-first-byte (SSE first event) | orchestrator timing log line `chat.ttfb_ms` | `latency.chat_ttfb_p95_ms` | ≤ 1500 ms |
| **p95_vault_job_ms** | P95 of vault job end-to-end (PHP enqueue → orchestrator completion ack) | PHP `vault_jobs.completed_at - created_at` | `latency.vault_job_p95_ms` | ≤ 30 000 ms |
| **test_coverage_py** | `pytest --cov` line coverage for `python/oaao_orchestrator/` | pytest-cov XML | `tests.coverage_py_pct` | ≥ 65 % (current ~40 %) |
| **test_pass_rate** | passed / (passed + failed), excluding skipped, from latest CI run | pytest output | `tests.pass_rate_pct` | ≥ 99 % |
| **vuln_count_high** | `pip-audit` + `composer audit` high-severity advisories | CI audit job artefacts | `security.vuln_high` | 0 |
| **vuln_count_med** | medium-severity advisories | CI audit job artefacts | `security.vuln_med` | ≤ 5 |
| **broad_except_count** | `ruff` BLE-rule hits across `python/oaao_orchestrator/` | `ruff check --select BLE --statistics` | `code_health.broad_except` | ≤ baseline (113 noqa) |
| **php_style_violations** | `php-cs-fixer --dry-run` violation count | CI `php-style` job | `code_health.php_style` | 0 (after W2-S2 hard-fail flip) |
| **contract_drift** | Fields present in PHP fixtures but missing from `contracts/v1/*.json` | `test_contracts_v1.py` + `test_errors_contract.py` parity tests | `code_health.contract_drift` | 0 |
| **top20_closed_pct** | Closed Top-20 tech-debt items / 20 | `W1_Top20_TechDebt_Owner_Framework.md` §1 burn-down counters | `debt.top20_closed_pct` | ≥ 80 % by W9 exit |

### Snapshot shape (canonical)

```json
{
  "schema_version": "1",
  "captured_at": "2026-05-26T12:00:00Z",
  "git_sha": "abc1234",
  "error_rate":   { "http_5xx_24h": 0.0, "ws_4xxx_24h": 0.0 },
  "latency":      { "chat_ttfb_p95_ms": null, "vault_job_p95_ms": null },
  "tests":        { "pass_rate_pct": 94.9, "coverage_py_pct": null, "passed": 223, "failed": 12, "skipped": 3 },
  "security":     { "vuln_high": null, "vuln_med": null },
  "code_health":  { "broad_except": 0, "php_style": null, "contract_drift": 0 },
  "debt":         { "top20_closed_pct": 45.0, "p0_closed_pct": 58.0 }
}
```

Fields are `null` when the underlying signal is not yet wired (runtime metrics await W2-S3 / W12-S1).
The contract is **additive-only**: adding a metric does not break consumers, removing one requires bumping `schema_version`.

## 2. Daily snapshot pipeline

[scripts/kpi_snapshot.sh](../scripts/kpi_snapshot.sh) emits one JSON file per day to `docs/kpi/`. CI runs it nightly (cron workflow scoped for W2-S3 extension), and any developer can run it locally:

```bash
bash scripts/kpi_snapshot.sh             # writes docs/kpi/$(date -u +%Y-%m-%d).json
bash scripts/kpi_snapshot.sh --stdout    # print to stdout, do not write
```

Each snapshot is reviewed at the Friday burn-down. A simple delta diff against the previous day is the v1 "dashboard"; a hosted Grafana board is the W12 stretch goal once Prom exporters are exposed.

## 3. Acceptance (per backlog)

- [x] KPI list defined with source + snapshot field name (this doc)
- [x] Tracked KPIs include: error rate, P95, test coverage, vulnerability count
- [x] Daily automatic snapshot script (`scripts/kpi_snapshot.sh`)
- [x] First snapshot committable to `docs/kpi/` (verified by smoke run during W1-S2 delivery)
