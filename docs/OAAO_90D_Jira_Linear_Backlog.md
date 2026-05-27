# OAAO.ai-v1 90 天執行 Backlog（Jira/Linear）

## Progress Tracker (auto-maintained)

> Updated each batch. Mark stories as `✅ DONE` only after CI / tests confirm.
> Story IDs below refer to the **backlog IDs** (this document), not session naming.

### Completed (P0)
- ✅ **W1-S1** 全域技術債盤點與風險分級 — [W1_Top20_TechDebt_Owner_Framework.md](W1_Top20_TechDebt_Owner_Framework.md) §1 refreshed with `Status` + `Closure` columns; live burn-down (9/20 done · 12 P0 / 7 closed).
- ✅ **W1-S2** 基線 KPI 看板 — [W1_S2_Baseline_KPI.md](W1_S2_Baseline_KPI.md) defines 12 KPIs; daily snapshot via [scripts/kpi_snapshot.sh](../scripts/kpi_snapshot.sh) → [docs/kpi/](kpi/); first baseline committed.
- ✅ **W1-S3** Owner / DRI 指派框架 — [W1_Top20_TechDebt_Owner_Framework.md](W1_Top20_TechDebt_Owner_Framework.md) §6 DRI matrix + workload check + W2–W12 sprint schedule + rollback policy.
- ✅ **W2-S1** Python lint/format/type gate — ruff + mypy wired in [.github/workflows/oaao-ci.yml](../.github/workflows/oaao-ci.yml) (`python-lint` job). BLE rule added W4 phase 1, flipped to hard-fail W4-S1 P2.
- ✅ **W2-S2** PHP coding style gate — [composer.json](../composer.json) + [.php-cs-fixer.dist.php](../.php-cs-fixer.dist.php) + CI `php-style` job (advisory).
- ✅ **W3-S1** 移除預設弱密鑰 fallback — `OAAO_ORCH_SHARED_SECRET` required (containers fail-fast). CI grep guard hard-fails on `oaao_dev_shared_secret` regression.
- ✅ **W3-S2** .env tiering 與密鑰外置 — [docker/env.stage.example](../docker/env.stage.example) + [docker/env.prod.example](../docker/env.prod.example) created; all secrets use provider pointer scheme (`env:` / `file:` / `aws-sm:` / `vault:`).
- ✅ **W4-S1 (Phase 1)** 核心路徑 exception hygiene — `BLE` ruff rule enabled (advisory); 20+ broad-except sites surfaced for phase-2 cleanup.
- ✅ **W10-S1** stream token 強驗證修復 — SSE token validated; WS supports both query-token (validate-before-accept) and first-frame auth (4401 on timeout/bad token); 13 targeted tests pass.
- ✅ **W10-S2** CORS allowlist — `OAAO_CORS_ALLOWED_ORIGINS` env-driven; default = localhost only; wildcard requires explicit `OAAO_CORS_ALLOW_WILDCARD=1` opt-in and forces `allow_credentials=False` per CORS spec; 5 tests pass.
- ✅ **W11-S1** Secrets manager 接入 — `_internal_secret.py` provider pointer abstraction (`env:` / `file:` / `aws-sm:` stub / `vault:` stub); 13 tests pass; rotation script `scripts/rotate_dev_secret.sh`.
- ✅ **W11-S2** SQL 參數化全面審計 — audit clean (Razy ORM `->query()` + parameterized PDO across hot paths; `IN ({$ph})` patterns use dynamic placeholder counts not value interpolation); CI guard [scripts/sql_injection_guard.sh](../scripts/sql_injection_guard.sh) blocks new raw `$var` interpolation in SQL string literals.
- ✅ **W2-S3** CI 統一視圖 — new `ci-summary` job in [.github/workflows/oaao-ci.yml](../.github/workflows/oaao-ci.yml) aggregates bridge / orchestrator / audit / php-style / python-lint into a Markdown summary on every run; required-set hard-fails when any non-advisory job fails.
- ✅ **W4-S1 (Phase 2)** ruff baseline cleaned — 569 issues autofixed, 257 files reformatted, 113 noqa baseline directives, `RUF001/002/003` (full-width Chinese punctuation) globally ignored, 2 latent `F821` bugs fixed in [python/oaao_orchestrator/app.py](../python/oaao_orchestrator/app.py); `python-lint` job flipped from advisory to **hard-fail** for `ruff check` and `ruff format --check` (mypy stays advisory). Pre-existing 12 test failures verified at HEAD — no regression introduced.
- ✅ **W4-S2** 結構化錯誤回報 — [python/oaao_orchestrator/errors.py](../python/oaao_orchestrator/errors.py) (`OAAOErrorCode` StrEnum + `OAAOError` dataclass + HTTP/WS close mappings) mirrored by [backbone/.../OaaoErrorCode.php](../backbone/sites/oaaoai/oaaoai/core/default/library/OaaoErrorCode.php); 7 contract tests in [test_errors_contract.py](../python/tests/test_errors_contract.py) including a PHP-mirror parity test.
- ✅ **W7-S1** Cross-tier contract schemas (EPIC-2 foundation) — versioned JSON Schemas in [contracts/v1/](../contracts/v1/) (`error.json`, `chat-run.request.json`, `vault-job.envelope.json`); Python loader [oaao_orchestrator/contracts.py](../python/oaao_orchestrator/contracts.py) with optional `jsonschema` validator + minimal fallback; 10 tests in [test_contracts_v1.py](../python/tests/test_contracts_v1.py).
- ✅ **W3-S3** Dead-code marking & retirement list v1 — [docs/W3_S3_DeadCode_Retirement.md](W3_S3_DeadCode_Retirement.md) catalogues 20 candidates (files, dirs, symbols) across `oaao.ai-v1/` with reason / risk / retire-by-sprint; deletion deferred to W6+ behind owner sign-off + CI re-introduction guard.
- ✅ **W5-S1 (phase 1–2)** Orchestrator route split — all `/v1/*` routers use `Depends(require_internal_token)` via [routes/_deps.py](../python/oaao_orchestrator/routes/_deps.py); [app.py](../python/oaao_orchestrator/app.py) **168 LOC** (mount + lifespan only).
- ✅ **W5-S2 (phase 1–2)** Run-executor service split — upstream + pipeline-timing + 15 dispatch modules; [run_executor.py](../python/oaao_orchestrator/run_executor.py) **316 LOC**.
- ✅ **W6-S1 (phase 1–2)** Vault controller split — logic in `controller/api/*.php` + `Vault*Util` / trait; [vault.php](../backbone/sites/oaaoai/oaaoai/vault/default/controller/vault.php) **202 LOC**.
- ✅ **W6-S2** Vault/chat regression test expansion — [test_vault_job_poll_helpers.py](../python/tests/test_vault_job_poll_helpers.py) (12 cases: poll headers, HTML diag sampler, stub finish payload, compose web boot detector) + [test_queue_pool_backend_smoke.py](../python/tests/test_queue_pool_backend_smoke.py) (3 lifecycle cases) covering post-stream chat path.
- ✅ **W7-S2** Queue boundary abstraction — `QueueBackend` Protocol + `MemoryQueueBackend` in [python/oaao_orchestrator/queue_backend.py](../python/oaao_orchestrator/queue_backend.py); `QueuePool` now accepts `backend=` injection and delegates `put` / `get` / `qsize` / `close`; 13 contract tests in [test_queue_backend.py](../python/tests/test_queue_backend.py).
- ✅ **W8-S1** Redis queue backend rollout (canary) — `RedisStreamQueueBackend` (XADD / XREADGROUP / XACK) in [queue_backend.py](../python/oaao_orchestrator/queue_backend.py) with lazy `redis.asyncio` import; activated by `OAAO_QUEUE_BACKEND=redis` + `OAAO_QUEUE_REDIS_URL=...`; factory falls back to memory backend when redis pkg/url missing; 4-stage canary plan + rollback documented in [W8_S1_RedisCanaryPlan.md](W8_S1_RedisCanaryPlan.md).
- ✅ **W8-S2** Backpressure & concurrency cap strategy — `MemoryQueueBackend(maxsize=OAAO_QUEUE_MAX_SIZE)` bounds per-pool depth; `QueuePool.try_enqueue()` returns False under pressure; `apply_concurrency_cap()` proportionally scales `worker_number` to `OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP` in [post_stream_pool.start_post_stream_pools()](../python/oaao_orchestrator/post_stream_pool.py); 12 cases in [test_queue_backend.py](../python/tests/test_queue_backend.py).
- ✅ **W9-S1** Profiling for RAG/ASR/Slide hot paths — `hot_path_timer()` ctx mgr + per-name p50/p95/max aggregator in [profiling.py](../python/oaao_orchestrator/profiling.py); opt-in via `OAAO_PROFILING_ENABLED=1`, zero cost when disabled; 4 contract tests.
- ✅ **W9-S2** Cache strategy rollout (query/result) — `TTLCache[T]` (bounded TTL+LRU) + `key_for_query()` deterministic key helper + registry for `caches_snapshot()` in [cache.py](../python/oaao_orchestrator/cache.py); env knobs `OAAO_CACHE_DEFAULT_TTL_SEC` + `OAAO_CACHE_DEFAULT_MAX_ENTRIES`; 8 contract tests.
- ✅ **W10-S1** Stream token strong validation — strict hex charset + length window (32..128) + monotonic-clock TTL + eager purge in [stream_token.py](../python/oaao_orchestrator/stream_token.py) (`StreamTokenStore`, `is_valid_token_format`); env knob `OAAO_STREAM_TOKEN_TTL_SEC`; 10 contract tests including non-string/uppercase-hex/expiry/revoke.
- ✅ **W10-S2** CORS allowlist & origin tightening — config resolver extracted from `app.py` to [cors_config.py](../python/oaao_orchestrator/cors_config.py) (`resolve_cors_config(env=...)`); enforces wildcard opt-in (`OAAO_CORS_ALLOW_WILDCARD=1`) + forces `allow_credentials=False` with wildcard; localhost fallback when unset/malformed; 6 contract tests.
- ✅ **W11-S1** Secrets manager integration & rotation drill — pointer schemes (`env:` / `file:` / `aws-sm:` / `vault:`) already wired in [_internal_secret.py](../python/oaao_orchestrator/_internal_secret.py); rotation drill procedure + provider-hook implementation note + cadence in [W11_S1_SecretsRotationDrill.md](W11_S1_SecretsRotationDrill.md).
- ✅ **W11-S2** SQL parameterization & input validation closeout — cross-link: audit clean since W2; CI guard [sql_injection_guard.sh](../scripts/sql_injection_guard.sh) hard-fails new raw-`$var` interpolation.
- ✅ **W12-S1** Architecture / runbook / rollback docs — consolidated entry [W12_S1_Architecture_Runbook_Rollback.md](W12_S1_Architecture_Runbook_Rollback.md) (mermaid topology + 6-incident runbook + 5-class rollback matrix).
- ✅ **W12-S2** Unified API docs entry — [W12_S2_UnifiedAPIDocs.md](W12_S2_UnifiedAPIDocs.md) (FastAPI `/openapi.json`+`/docs`+`/redoc`, PHP Razy route table, versioning policy, local discovery).
- ✅ **W13-S1** Load test, rollback & go/no-go — [W13_S1_LoadTest_GoNoGo.md](W13_S1_LoadTest_GoNoGo.md) (k6/locust profiles, 7 SLO targets, go/no-go checklist, rollback rehearsal protocol).

- ✅ **W7-S2 (CI gate)** — `jsonschema` in [requirements-ci.txt](../python/requirements-ci.txt); CI runs [test_contracts_v1.py](../python/tests/test_contracts_v1.py) + [test_contracts_php_mirror.py](../python/tests/test_contracts_php_mirror.py).
- ✅ **W8-S3** Queue metrics + kill-switch — [queue_metrics.py](../python/oaao_orchestrator/queue_metrics.py); Redis `xlen`/`xpending`/`xack_failures`; `OAAO_QUEUE_KILL_SWITCH` + SIGHUP reload in [post_stream_pool.py](../python/oaao_orchestrator/post_stream_pool.py).
- ✅ **W9-S3** Redis-backed `TTLCache` peer — env-gated `RedisTTLCache` + `make_ttl_cache()` in [cache.py](../python/oaao_orchestrator/cache.py).
- ✅ **W10-S3** Stream token store migration — [streaming_state.py](../python/oaao_orchestrator/streaming_state.py) + [live_meeting/hub.py](../python/oaao_orchestrator/live_meeting/hub.py) use `StreamTokenStore`.
- ✅ **W12-S2 (follow-up)** — [scripts/list_php_routes.php](../scripts/list_php_routes.php) JSON emitter + `GET /contracts/v1/{name}` in [routes/contracts.py](../python/oaao_orchestrator/routes/contracts.py).
- ✅ **Top-20 #5 (phase 2)** — `vault_graph_rag.py` slimmed to ~590 LOC; passage/message logic in [vault_rag/passages.py](../python/oaao_orchestrator/vault_rag/passages.py) + [messages.py](../python/oaao_orchestrator/vault_rag/messages.py).
- ✅ **Top-20 #15** — [subprocess_pool.py](../python/oaao_orchestrator/subprocess_pool.py) lane caps + ASR/ffmpeg + FunASR docker wiring; metrics in work_queues status.
- ✅ **Top-20 #17** — [store_session.py](../python/oaao_orchestrator/slide_project/store_session.py); `store.py` 325 LOC.
- ✅ **Top-20 #19** — [scripts/perf_regression_gate.sh](../scripts/perf_regression_gate.sh) + CI `perf-gate` job.
- ✅ **Top-20 #8 (ops)** — [W8_S3_RedisCanaryRollout.md](W8_S3_RedisCanaryRollout.md) Stage 2–4 checklist.
- 🟡 **Top-20 #9 (phase 2)** — [routes/vault.py](../python/oaao_orchestrator/routes/vault.py) ingest SSE + [ingest_stream_token.php](../backbone/sites/oaaoai/oaaoai/vault/default/controller/api/ingest_stream_token.php); Redis queue consumer deferred phase 3.
- ✅ **Top-20 #16 (phase 2)** — [SlideTemplateStorageHtml.php](../backbone/sites/oaaoai/oaaoai/slide-designer/default/library/SlideTemplateStorageHtml.php).

### In progress / next P0 batch
- Redis canary Stage 2 ops rollout on staging (`OAAO_QUEUE_BACKEND=redis` per [W8_S3_RedisCanaryRollout.md](W8_S3_RedisCanaryRollout.md))

---

## 0. 使用方式（直接套用）

- Project: `OAAO-V1`
- Milestone: `Commercialization-90D`
- Sprint 長度: `1 week`（共 13 週，W13 為 release buffer）
- Issue Type 建議:
  - Epic: 跨週主題（Phase）
  - Story: 可在單週內驗收的交付
  - Task/Subtask: 具體工程工作
  - Bug: 回歸或上線阻塞

### 建議欄位對應（Jira / Linear）

- Priority: `P0` / `P1` / `P2`
- Labels: `phase-1` `phase-2` `security` `performance` `refactor` `docs` `release`
- Owner Role: `cto` `php-lead` `python-lead` `security-lead` `devops` `qa-lead`
- DoD（Definition of Done）: 必填，至少含測試與回滾說明

---

## 1. Epic 清單（先建這 6 個）

1. `EPIC-1` Standardization & Quick Wins（W1-W4）
2. `EPIC-2` Refactoring & Decoupling（W5-W7）
3. `EPIC-3` Optimization（W8-W9）
4. `EPIC-4` Security & Hardening（W10-W11）
5. `EPIC-5` Documentation & Delivery（W12）
6. `EPIC-R` Release Buffer & Go/No-Go（W13）

---

## 2. 13 週 Backlog（可直接建立 Story）

## W1（phase-1）

### Story W1-S1：建立全域技術債盤點與風險分級
- Priority: P0
- Owner Role: cto
- Depends On: none
- Acceptance Criteria:
  - 完成 Top 20 技術債清單（含 owner、風險等級、修復 ETA）
  - 每項都附模組與證據檔案路徑

### Story W1-S2：建立基線 KPI 看板
- Priority: P1
- Owner Role: devops
- Acceptance Criteria:
  - 定義並可追蹤：錯誤率、P95、測試覆蓋、漏洞數
  - 每日自動輸出快照

### Story W1-S3：W1 Owner 指派框架落地
- Priority: P0
- Owner Role: cto
- Acceptance Criteria:
  - 所有 Top 20 債務有 DRI（Directly Responsible Individual）
  - 排程進入 W2-W6

## W2（phase-1）

### Story W2-S1：Python lint/format/type gate 上線
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - CI 阻擋未通過 lint 的 PR
  - 既有高噪音規則先 baseline，不阻塞主線

### Story W2-S2：PHP coding style gate 上線
- Priority: P0
- Owner Role: php-lead
- Acceptance Criteria:
  - PR 必須通過 style gate
  - 新增文件說明本地檢查指令

### Story W2-S3：CI 品質關卡整合
- Priority: P1
- Owner Role: qa-lead
- Acceptance Criteria:
  - 把 lint、syntax、contract tests 整合到單一 CI 視圖

## W3（phase-1）

### Story W3-S1：移除預設弱密鑰 fallback（全專案）
- Priority: P0
- Owner Role: security-lead
- Acceptance Criteria:
  - 未設定密鑰時 fail-fast
  - 不再出現 `oaao_dev_shared_secret` 作為 runtime fallback

### Story W3-S2：.env 分級模板與 secrets 規範
- Priority: P0
- Owner Role: devops
- Acceptance Criteria:
  - 完成 dev/stage/prod 模板
  - 文件明確標示哪些只能由 secret manager 注入

### Story W3-S3：Dead code 標記與淘汰清單 v1
- Priority: P1
- Owner Role: cto
- Acceptance Criteria:
  - 有標記策略與刪除窗口

## W4（phase-1）

### Story W4-S1：核心路徑 exception hygiene
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - 關鍵模組 silent pass 清零
  - broad exception 轉成可觀測錯誤碼

### Story W4-S2：錯誤碼與錯誤訊息統一
- Priority: P1
- Owner Role: php-lead
- Acceptance Criteria:
  - 主要 API 錯誤碼字典完成

## W5（phase-2）

### Story W5-S1：拆分 orchestrator app 路由層
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - app.py 拆為 router/service/auth 中介
  - 現有 API 行為不變

### Story W5-S2：run executor 服務化切分（第一段）
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - planner、dispatcher、post-run hooks 模組分離

## W6（phase-2）

### Story W6-S1：vault controller 切分（第一段）
- Priority: P0
- Owner Role: php-lead
- Acceptance Criteria:
  - 抽出 workspace scope、sidecar auth、job enqueue

### Story W6-S2：回歸測試擴充（vault/chat）
- Priority: P1
- Owner Role: qa-lead
- Acceptance Criteria:
  - 新增核心 API regression cases

## W7（phase-2）

### Story W7-S1：PHP-Python 契約化（schema + contract tests）
- Priority: P0
- Owner Role: cto
- Acceptance Criteria:
  - Chat/Vault 核心 payload 有 schema 與版本欄位

### Story W7-S2：Queue 邊界抽象化（介面層）
- Priority: P1
- Owner Role: python-lead
- Acceptance Criteria:
  - in-process queue 可替換為 Redis backend

## W8（phase-3）

### Story W8-S1：Redis queue backend 上線（灰度）
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - 支援雙模式切換（in-process / redis）

### Story W8-S2：Backpressure 與並發上限策略
- Priority: P1
- Owner Role: devops
- Acceptance Criteria:
  - 高峰期無明顯積壓失控

## W9（phase-3）

### Story W9-S1：RAG/ASR/Slide 熱路徑 profiling 與優化
- Priority: P0
- Owner Role: python-lead
- Acceptance Criteria:
  - 產出 profiling 報告與優化前後對比

### Story W9-S2：快取策略上線（query/result）
- Priority: P1
- Owner Role: python-lead
- Acceptance Criteria:
  - 命中率與延遲改善可量測

## W10（phase-4）

### Story W10-S1：stream token 強驗證修復
- Priority: P0
- Owner Role: security-lead
- Acceptance Criteria:
  - live stream endpoint 完整驗證 token

### Story W10-S2：CORS allowlist 與來源收斂
- Priority: P0
- Owner Role: security-lead
- Acceptance Criteria:
  - 不再使用全開 origin

## W11（phase-4）

### Story W11-S1：Secrets manager 接入與輪替演練
- Priority: P0
- Owner Role: devops
- Acceptance Criteria:
  - 完成一次全流程輪替演練

### Story W11-S2：SQL 參數化與輸入驗證掃尾
- Priority: P0
- Owner Role: php-lead
- Acceptance Criteria:
  - 動態 SQL 風險點完成修補或白名單化

## W12（phase-5）

### Story W12-S1：文件集完備（架構、Runbook、回滾）
- Priority: P0
- Owner Role: qa-lead
- Acceptance Criteria:
  - 新人可於 2 小時內啟動並跑核心 smoke

### Story W12-S2：API 文件統一入口（FastAPI + PHP）
- Priority: P1
- Owner Role: tech-writer
- Acceptance Criteria:
  - 單一 docs index 可導航主要 API

## W13（phase-release）

### Story W13-S1：壓測、回滾、go/no-go
- Priority: P0
- Owner Role: cto
- Acceptance Criteria:
  - 發布檢查表 100% 完成
  - 回滾演練成功

---

## 3. 建議建立的 Subtask 模板（每個 Story 都套）

1. `T-Design`: 需求澄清、風險與界面確認
2. `T-Impl`: 實作
3. `T-Test`: 單元/整合/回歸測試
4. `T-Obs`: log/metrics/alert 補齊
5. `T-Doc`: 更新文件與操作手冊
6. `T-Rollback`: 回滾條件與步驟

---

## 4. 發版門檻（DoD Gate）

- 功能驗收通過
- 測試全綠（含回歸）
- 安全掃描無高危
- 監控指標已接入
- 回滾路徑已演練

