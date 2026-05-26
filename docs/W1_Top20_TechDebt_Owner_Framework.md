# W1 Top 20 技術債與 Owner 指派框架（oaao.ai-v1）

## 0. 評分規則（W1 使用）

- 風險等級: `High` / `Med` / `Low`
- 緊急度: `P0`（本週必動）/ `P1`（兩週內）/ `P2`（排程）
- 建議 owner role:
  - Python 平台類: `python-lead`
  - PHP 應用類: `php-lead`
  - 安全策略類: `security-lead`
  - 平台與交付類: `devops`
  - 測試守門類: `qa-lead`

---

## 1. Top 20 技術債（含證據 + 收尾狀態）

> **W1-S1 refresh**: `Status` 與 `Closure` 兩欄為 W1-S1 deliverable，每次完成 backlog story 後更新。
> `Closure` 連到實際 PR / story / 證據檔；`Status` = `✅ Done` / `🟡 Active` / `🟠 Scheduled` / `⬜ Open`。

| Rank | 項目 | 風險 | 優先級 | Owner Role / DRI | Status | Closure (sprint + evidence) | 證據（原始） |
|---|---|---|---|---|---|---|---|
| 1 | Live stream token 參數未強驗證 | High | P0 | security-lead | ✅ Done | W10-S1 — SSE/WS token strict-validate; 13 tests pass | [python/oaao_orchestrator/app.py](../python/oaao_orchestrator/app.py) |
| 2 | 預設 shared secret fallback 仍存在 | High | P0 | security-lead | ✅ Done | W3-S1 — fallback removed, fail-fast; CI grep guard | [python/oaao_orchestrator/run_principal.py](../python/oaao_orchestrator/run_principal.py), [backbone/.../vault.php](../backbone/sites/oaaoai/oaaoai/vault/default/controller/vault.php) |
| 3 | CORS 全開 allow_origins | High | P0 | security-lead | ✅ Done | W10-S2 — env-driven allowlist; wildcard requires explicit opt-in | [python/oaao_orchestrator/app.py](../python/oaao_orchestrator/app.py) |
| 4 | 巨型 PHP controller（單檔 1979 行） | High | P0 | php-lead | 🟠 Scheduled | W6-S1 (next) — vault controller modular split | [backbone/.../vault.php](../backbone/sites/oaaoai/oaaoai/vault/default/controller/vault.php) |
| 5 | 巨型 Python RAG 模組（1819 行） | High | P0 | python-lead | 🟠 Scheduled | W7-S2 — needs contract gate (W7-S1 done) before split | [python/oaao_orchestrator/vault_graph_rag.py](../python/oaao_orchestrator/vault_graph_rag.py) |
| 6 | 巨型執行器模組（1581 行） | High | P0 | python-lead | 🟡 In progress | W5-S2 phase 1 — upstream sampling/timeout extracted to `run_executor_upstream.py`; phase 2 — pipeline-timing helpers extracted to `run_executor_timing.py` (`elapsed_ms_since`, `record_pipeline_phase`, `record_pipeline_task`, `finalize_run_task_timing`); phase 3 — vault-RAG helpers (`vault_rag_ctx_extra`, `apply_vault_rag_agent_result`, `inject_compose_vault_awareness`) extracted to `run_executor_vault_rag.py`; run_executor.py 1757→1619 LOC | [python/oaao_orchestrator/run_executor.py](../python/oaao_orchestrator/run_executor.py) |
| 7 | 核心 app.py 過重（1384 行） | High | P1 | python-lead | 🟡 In progress | W5-S1 phase 1 — admin + health extracted; phase 2 — `/v1/mine/*` + `/v1/research/*` moved; phase 3 — `/v1/live/*` moved; phase 4 — `/v1/runs/{id}/agent_ask|cancel` + `/v1/stream` moved to `routes/runs.py` (registry + `_stream_tokens` into `streaming_state.py`); `/v1/slides/*` moved to `routes/slides.py` (`EndpointPayload` lifted into `routes/_shared_models.py`); app.py 1707→712 LOC; remaining: `/v1/runs/chat` (blocked on #6 phase 3) + ASR/FunASR + work-queue admin endpoints | [python/oaao_orchestrator/app.py](../python/oaao_orchestrator/app.py) |
| 8 | Queue 仍為 in-process，缺可擴展 backend | High | P1 | python-lead | 🟠 Scheduled | W8-S1 — Redis queue canary | [python/oaao_orchestrator/queue_pool.py](../python/oaao_orchestrator/queue_pool.py) |
| 9 | vault job 仍依賴 HTTP poll，跨服務耦合高 | High | P1 | python-lead | 🟠 Scheduled | W8-S2 — SSE/queue unification | [python/oaao_orchestrator/vault_job_poll.py](../python/oaao_orchestrator/vault_job_poll.py) |
| 10 | Python 廣泛 broad exception + pass | High | P1 | python-lead | ✅ Done | W4-S1 P1 (surface) + P2 (cleanup) — `BLE` hard-fail in CI; 113 noqa baselined | [python/oaao_orchestrator/vault_graph_rag.py](../python/oaao_orchestrator/vault_graph_rag.py), [pyproject.toml](../pyproject.toml) |
| 11 | 缺專案級 Python style/type 規範檔 | Med | P1 | devops | ✅ Done | W2-S1 + W4-S1 P2 — ruff hard-fail, mypy advisory | [pyproject.toml](../pyproject.toml), [.github/workflows/oaao-ci.yml](../.github/workflows/oaao-ci.yml) |
| 12 | 缺專案級 PHP style 規範檔 | Med | P1 | devops | ✅ Done | W2-S2 — `.php-cs-fixer.dist.php` + advisory CI job | [.php-cs-fixer.dist.php](../.php-cs-fixer.dist.php) |
| 13 | SQL 字串拼接查詢風險點存在 | High | P1 | php-lead | ✅ Done | W11-S2 — audit clean; CI guard `scripts/sql_injection_guard.sh` | [scripts/sql_injection_guard.sh](../scripts/sql_injection_guard.sh) |
| 14 | .env 範本含 dev 密碼與共享 secret 慣例 | High | P0 | devops | ✅ Done | W3-S2 — env tiering with provider-pointer schema | [docker/env.stage.example](../docker/env.stage.example), [docker/env.prod.example](../docker/env.prod.example) |
| 15 | subprocess 熱點分散，可能造成資源抖動 | Med | P1 | python-lead | ⬜ Open | W9-S1 candidate — subprocess pool + back-pressure | [python/oaao_orchestrator/funasr_ops.py](../python/oaao_orchestrator/funasr_ops.py) |
| 16 | slide template 儲存模組過肥（1149 行） | Med | P2 | php-lead | ⬜ Open | W9-S2 candidate — defer until W6-S1 pattern stable | [backbone/.../SlideTemplateStorage.php](../backbone/sites/oaaoai/oaaoai/slide-designer/default/library/SlideTemplateStorage.php) |
| 17 | slide project store 過肥（1104 行） | Med | P2 | python-lead | ⬜ Open | W9-S2 candidate — defer until W5-S2 pattern stable | [python/oaao_orchestrator/slide_project/store.py](../python/oaao_orchestrator/slide_project/store.py) |
| 18 | CI 缺安全掃描 gate | Med | P1 | security-lead | ✅ Done | W11-S3 Phase 2 — gitleaks + pip-audit promoted to required; baseline clean (46 commits, 0 leaks); Pillow >=12.2 closes 6 CVEs. composer audit stays advisory until root composer.json lands. | [.github/workflows/oaao-ci.yml](../.github/workflows/oaao-ci.yml) |
| 19 | CI 缺性能回歸 gate | Med | P2 | qa-lead | ⬜ Open | W12-S1 candidate — needs KPI baseline (W1-S2 ✅) before threshold | [.github/workflows/oaao-ci.yml](../.github/workflows/oaao-ci.yml) |
| 20 | 文件入口分散，對外契約不集中 | Low | P2 | qa-lead | 🟡 Active | W7-S1 partial — `contracts/v1/` index established; full doc consolidation in W12 | [contracts/README.md](../contracts/README.md) |

**Burn-down @ today** — Top 20: 9 ✅ Done (#1,2,3,10,11,12,13,14,18) · 2 🟡 In progress (#6,7) · 1 🟡 Active (#20) · 4 🟠 Scheduled (#4,5,8,9) · 4 ⬜ Open (#15,16,17,19) · **closed-rate 45%**.
P0 subset (7 items: #1,2,3,4,5,6,14): 4 ✅ (#1,2,3,14) · 1 🟡 In progress (#6) · 2 🟠 Scheduled (#4,5) · 0 ⬜ · **P0 closed-rate 57%**.

---

## 2. W1 Owner 指派規則（直接執行）

1. 每個債務只能有 1 個 DRI，不接受共同負責
2. P0 項目必須在 W1 指派，且 W2 有可驗收輸出
3. 每個 owner 本週最多承擔 3 個 P0，避免過載
4. 同模組債務優先綁定同 owner，減少上下文切換
5. 安全相關 P0 必須由 security-lead co-sign

---

## 3. RACI（簡版）

| 類型 | R（負責） | A（最終負責） | C（諮詢） | I（知會） |
|---|---|---|---|---|
| 安全修補 | security-lead | cto | php-lead/python-lead | qa-lead/devops |
| Python 架構拆分 | python-lead | cto | qa-lead | devops/security-lead |
| PHP 架構拆分 | php-lead | cto | qa-lead | devops/security-lead |
| CI Gate / 平台 | devops | cto | qa-lead | php-lead/python-lead |
| 測試與驗收 | qa-lead | cto | php-lead/python-lead | security-lead/devops |

---

## 4. W1 立即行動清單（48 小時內）

1. 建立 `TOP20` issue set（每項一張卡）
2. 指派 DRI + due date + risk label
3. P0 開工前先補最小回歸測試
4. 每日 standup 固定更新：阻塞、風險、ETA
5. 週五做一次 Top20 burn-down 回顧

---

## 5. 週五驗收輸出（W1 Exit Criteria）

- Top20 全部有 owner
- P0 全部進入 active sprint
- P0 每項都有驗收條件與回滾方案
- 完成一版風險燃盡圖（open vs closed）

---

## 6. W1-S3 — DRI 指派矩陣 (sprint-scheduled)

> Each Top-20 item has exactly **one** DRI. Co-signs are tracked separately in the RACI table (§3).
> Schedule column maps to the backlog week; ✅ items already shipped and require only verification at burn-down review.

| Rank | DRI | Co-sign | Sprint | Verification artefact |
|---|---|---|---|---|
| 1 | security-lead | python-lead | W10 ✅ | 13 stream-token tests + WS 4401 close |
| 2 | security-lead | devops | W3 ✅ | CI grep guard `oaao_dev_shared_secret` |
| 3 | security-lead | python-lead | W10 ✅ | 5 CORS allowlist tests |
| 4 | php-lead | qa-lead | **W6** | controller LOC ≤ 600; preserves contract tests |
| 5 | python-lead | qa-lead | **W7** | RAG split + W7-S1 contract gate green |
| 6 | python-lead | qa-lead | **W5** | run-executor split; smoke job green |
| 7 | python-lead | qa-lead | **W5** | route split; orchestrator-smoke green |
| 8 | python-lead | devops | **W8** | Redis canary; flag-gated rollout |
| 9 | python-lead | devops | **W8** | SSE unification; W8-S2 contract test |
| 10 | python-lead | devops | W4 ✅ | `ruff BLE` hard-fail; 113 noqa baseline |
| 11 | devops | python-lead | W2 + W4 ✅ | `python-lint` hard-fail in CI |
| 12 | devops | php-lead | W2 ✅ | `php-style` advisory; PR template note |
| 13 | php-lead | security-lead | W11 ✅ | `sql_injection_guard.sh` blocks regression |
| 14 | devops | security-lead | W3 ✅ | `env.stage.example` + `env.prod.example` |
| 15 | python-lead | qa-lead | **W9** | subprocess pool + back-pressure metrics |
| 16 | php-lead | qa-lead | **W9** | apply W6-S1 pattern post-stabilisation |
| 17 | python-lead | qa-lead | **W9** | apply W5-S2 pattern post-stabilisation |
| 18 | security-lead | devops | W11 ✅ P2 | secret-scan + dep-audit CI gate hardened (required) |
| 19 | qa-lead | python-lead | **W12** | perf-bench CI step + thresholds from W1-S2 KPIs |
| 20 | qa-lead | tech-writer | **W12** | docs index + contract index page |

### Workload check (max 3 active P0 per owner)

| Owner | Active P0 this batch | Within limit? |
|---|---|---|
| security-lead | 1 (#18) | ✅ |
| python-lead | 3 (#6, #7, #5) — W5 + W7 | ✅ (W5 two parallel sub-stories under one owner is allowed; reviewed at burn-down) |
| php-lead | 1 (#4) | ✅ |
| devops | 0 | ✅ |
| qa-lead | 0 | ✅ |

### Burn-down cadence

- **Daily**: each DRI posts blockers in standup; updates `Status` column inline in this file.
- **Weekly (Friday)**: tech-writer regenerates §1 status counters from the table; KPI snapshot ([scripts/kpi_snapshot.sh](../scripts/kpi_snapshot.sh)) appends to [docs/kpi/](../docs/kpi/) directory.
- **Phase exit (W6, W9, W12)**: cto reviews closure-rate + risk burn-down chart, re-grades any items that slipped on ETA.

### Rollback policy

For every P0 closure, the DRI MUST land a revert-ready PR (single squashed commit on a feature branch, no DB schema changes without paired down-migration). The verification artefact column above is the minimum that must continue to pass after rollback rehearsal.

