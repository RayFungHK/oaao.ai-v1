# oaao.ai — Pipeline & Hook 除錯指南

對照完整審計：**[Audit_Report.md](./Audit_Report.md)**。

---

## 1. 快速判斷：問題在哪一層

| 症狀 | 先查 |
|------|------|
| SPA 頁面／側欄不出現 | PHP `api('core')` + `trigger('*.register')` → `core.main` JSON |
| 送訊後無 SSE | orchestrator 是否啟動、`OAAO_ORCH_*` URL/secret、`send.php` 回傳 `stream_url` |
| Checklist 有步驟但無 vault 引用 | Python `vault_rag` agent、`vault_auto_rag` / `allowed_agents` |
| Planner 很慢或一直多步 | `needs_multi_agent_turn`、`build_fast_chat_plan` vs `build_run_plan` |
| Live meeting 麥克風無反應 | `live-meeting-panel.js` 是否 export **`mountShellPanel`** |
| 跨模組改動後 500 | 是否違規 `require` 他模組 library（見審計 §6） |

---

## 2. 執行 Python 測試

**各測試／smoke 驗證內容與預期結果** → [Test_Catalog.md](./Test_Catalog.md)。

**改程式後不必等 user 點 UI**：先跑 `bash scripts/sandbox_check.sh`（大改用 `--all`）。見 Test_Catalog §2.0。

在 repo 根目錄（或 `python/`）：

```bash
cd /Users/rayfung/Desktop/Projects/oaao.ai-v1/python
python -m pytest tests/ -q
```

**聚焦子集**：

```bash
# Pipeline / Agent registry
python -m pytest tests/test_task_pipeline_phase0.py tests/test_fast_chat_planner.py -q

# Vault RAG 引用與 handbook
python -m pytest tests/test_vault_graph_rag_citations.py -q

# Live meeting
python -m pytest tests/test_live_meeting_live_stats.py tests/test_live_meeting_bubble_rag.py -q

# Hook 韌性（審計配套）
python -m pytest tests/test_pipeline_hook_resilience.py -q

# Bridge 契約（無需 pytest 插件）
python -m pytest tests/test_orchestrator_bridge_contract.py -q
```

## Orchestrator HTTP smoke（sidecar 需已啟動）

```bash
chmod +x scripts/oaao_orchestrator_smoke.sh
# Source your local docker/env (gitignored). To rotate the dev secret first:
#   ./scripts/rotate_dev_secret.sh        # Linux / macOS / WSL
#   ./scripts/rotate_dev_secret.ps1       # Windows PowerShell
OAAO_ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8103 \
OAAO_ORCH_SHARED_SECRET="$(grep -E '^OAAO_ORCH_SHARED_SECRET=' docker/env | cut -d= -f2-)" \
./scripts/oaao_orchestrator_smoke.sh

# 可選：啟動最小 chat run
OAAO_SMOKE_START_CHAT_RUN=1 ./scripts/oaao_orchestrator_smoke.sh
```

---

## 3. 追蹤一次 Chat Run（Python）

1. **入口**：`backbone/.../chat/default/controller/api/send.php` 組 payload → POST orchestrator `/v1/runs/chat`。
2. **規劃**：`oaao_orchestrator/planner.py` — `build_run_plan` / `build_fast_chat_plan`。
3. **執行**：`run_executor.py` — `execute_chat_run`。
4. **Agent**：`agents/registry.py` — `agent_kind` → `VaultRagAgent` 等。
5. **SSE**：`streaming/session.py` — `StreamRun.append`；前端訂閱 `oaao.stream` / `oaao_pipeline`。

**日誌**：設定 `LOG_LEVEL=DEBUG` 啟動 orchestrator（依你本地 compose / uvicorn 啟動方式）。

---

## 4. 追蹤 Register（PHP）

1. 各模組 `__onInit`：`$this->trigger('chat_pipeline.register')->resolve([...])` 等。
2. **唯一合併**：`endpoints/default/controller/endpoints.php` 的 `listen` 表。
3. **消費**：
   - Shell：`core/default/controller/core.main.php` → `ChatPipelineRegister::allSorted()`。
   - Send：`send.php` → `PlannerAgentRegister` + `agent_catalog`。

**手動驗證**（需已安裝站點）：登入後看 `core.main` 內嵌 JSON 是否含預期的 `chat_pipeline` / `planner_agents` 條目。

---

## 5. LLM_Mock（測試用）

路徑：`python/tests/support/llm_mock.py`

用途：在 pytest 中替換 planner / LLM 呼叫，避免真實 API。範例見 `tests/test_pipeline_hook_resilience.py`。

---

## 6. 本地環境變數（常見）

| 變數 | 用途 |
|------|------|
| `OAAO_ORCH_BASE_URL` | PHP → orchestrator |
| `OAAO_ORCH_SHARED_SECRET` | 內部 HMAC；**生產勿用** dev 預設 |
| `DASHSCOPE_API_KEY` | Live ASR（DashScope） |
| Qdrant / DB | vault RAG（見 vault 模組設定） |

---

## 7. 禁止事項（除錯時勿踩）

- 在 **PHP** 對瀏覽器開 SSE/WebSocket 長連線。
- 新功能用 `require_once` 拉他模組 `library/`（應 `api('模組')`）。
- 改 `../Razy` 後忘記重建 `backbone/Razy.phar`。

---

## 8. 相關文件

- [Audit_Report.md](./Audit_Report.md) — 違規表與重構清單
- [backbone/sites/oaaoai/oaaoai/docs/backlog/chat-task-pipeline.md](../backbone/sites/oaaoai/oaaoai/docs/backlog/chat-task-pipeline.md) — 目標 pipeline 模型
- [phase-iqs-accs-post-stream.md](./phase-iqs-accs-post-stream.md) — post-stream 佇列

## 9. Test_Suite（脫離 UI 的快速驗證層）

> 完整說明：[Test_Suite/README.md](../Test_Suite/README.md)。
> 用途：當你動了 `pipeline.py` / `run_executor.py` / `agents/*` / `streaming/*` 後，
> 不啟 FastAPI、不啟 PHP、不打外網，**30 秒**驗證 Hook 鏈仍可運作。

```bash
cd oaao.ai-v1

# 1. CLI Smoke：模擬「使用者訊息進、agent 回覆出」
python -m Test_Suite.smoke.cli_smoke "你好，oaao" --trace

# 2. 全套 black-box 測試（smoke + integration + resilience）
python -m pytest Test_Suite -q
```

### 失敗訊息解碼

| 看到的 error | 含義 | 處理 |
|---|---|---|
| `missing_agent_kind` | `RunTaskSpec.agent_kind` 為空 | 檢查 planner 是否漏填 `agent_kind` |
| `unknown_agent_kind:xxx` | 該名稱沒有 register 過 | 跑 `default_agent_factories()`；或檢查模組是否被 cleanup 刪除過頭 |
| `RuntimeError: boom` 直接竄出 | 已知 agent 拋錯且**沒**被外層包住 | 在 `run_executor` 或對應呼叫點加 try/except，回傳 `AgentResult(success=False)` 而非 raise |
| `ModuleNotFoundError: No module named 'Test_Suite'` | 工作目錄錯誤 | `cd oaao.ai-v1` 後再執行（不是 `oaao.ai-v1/python`） |

### 加新 agent 後的 checklist

1. `python -m Test_Suite.smoke.cli_smoke "ping" --agent <你的 kind>` 能成功；
2. `pytest Test_Suite/resilience -q` 仍綠（未把錯誤 propagate 到不該的層）；
3. 若新 agent 會修改 `RunContext.extra`，加一個對應的 `integration/test_*.py` 測試（參考 `test_pipeline_event_flow.py`）。

---

## 10. Evolution Loop 失敗解碼（IQS / ACCS / Reflection / Crystallization）

對照規格：[Evolution_System_Design.md](./Evolution_System_Design.md)、[Audit_Report.md §7](./Audit_Report.md)。

### 10.1 Envelope flag 對照表

| Flag | 出現條件 | 含義 / 處理 |
|---|---|---|
| `iqs_skipped=true` | IQS coach 熔斷或 timeout > 8s | E4B 評分鏈短路；prompt 直接放行到 planner。檢查 Box 1 vLLM 健康；查 `circuit_open:iqs` log |
| `iqs_action=clarify` | IQS 分數 < 0.50 | Pipeline 在 planner 前**暫停**，回 1–3 條 clarification 問題；前端應渲染為追問 bubble |
| `accs_skipped=true` | ACCS coach 熔斷或 timeout > 8s | 評分鏈短路；輸出**直接 ship**。檢查 `circuit_open:accs`、Box 1 E4B 負載 |
| `reflection_triggered=true` | ACCS ∈ [0.40, 0.65) | Main model 已重跑 1 輪；查 envelope 內 `reflection_round=1` 與第二輪 ACCS |
| `reflection_skipped=true` | `OAAO_REFLECTION_DISABLE=1` 或 ACCS < 0.40 | 第一種：手動關掉；第二種：太低不值得救，直接 ship 並標 degraded |
| `degraded=true` | ACCS 第二輪仍 < 0.40，或多個 skip flag 同時觸發 | **此輪不可結晶**；Crystallization Sealer 必須拒收 |
| `crystallization_candidate=true` | ACCS ≥ 0.85 且 `tool_chain` 長度 ≥ 2 | Sealer 可寫入 Qdrant + Arango；查 `crystallized_skills` collection |
| `circuit_open:<name>` | 連續 3 次失敗 / timeout | name ∈ {`iqs`, `accs`, `reflection`, `box1`, `box2`}；查 reset_timeout=600s 何時 half_open |

### 10.2 常見故障模式

| 症狀 | 先查 |
|---|---|
| 每個 run 都標 `iqs_skipped=true` | Box 1 vLLM E4B endpoint 不通；查 `endpoint.pick_base_url` 是否落到 unhealthy URL |
| ACCS 永遠 < 0.65 | Evidence 拿不到（vault_rag 沒掛上）；查 envelope `evidence=[]` 是否空 |
| Reflection 在 envelope 出現 2 次 | **違反契約**（max 1 round）；查 `evaluation.reflection.run_reflection_loop` 是否在外層被重新呼叫 |
| Crystallization 從未觸發 | 同時檢查 ACCS 分布（Daily Report `accs_p50`）與 `tool_chain` 長度；常見原因：fast-chat plan 只用單一 agent |
| Daily Report 顯示 ACCS 24h 內掉 > 5% | Auto-rollback 將觸發 evolution_patch revert；查 Arango `evolution_patches` 最近 `applied=true` 的補丁 |

---

## 11. 效能 / 容量測試（Test_Suite/perf）

```bash
# 跑 Phase 8/10 契約測試（落地前 skip，落地後自動激活）
pytest Test_Suite/perf -q

# 跑 Phase 8/9 evolution 契約測試
pytest Test_Suite/evolution -q
```

### 預期效能基線（兩台 GB10 128GB UMA）

| 指標 | Box 1 (Heavy / 31B FP8) | Box 2 (Throughput / 26B-A4B FP8) |
|---|---|---|
| TTFT p50 (短 prompt) | ≤ 800 ms | ≤ 350 ms |
| TPOT (token/s) | ≥ 35 t/s | ≥ 90 t/s (MoE 加速) |
| KV 池上限 | 40 GB | 40 GB |
| KV 池告警 (503 retry-after=2s) | ≥ 85% (34 GB) | ≥ 85% (34 GB) |
| 並發上限 (32k ctx) | ~8 streams | ~14 streams |
| Speculative decoding (E4B draft) | acceptance ≥ 60% | n/a |

### Circuit Breaker 預設值（`safety.circuit_breaker`）

| 參數 | 值 |
|---|---|
| `failure_threshold` | 3 |
| `call_timeout` | 8s |
| `reset_timeout` | 600s（10 分鐘 half_open 探針） |
| 命名 breakers | `iqs` / `accs` / `reflection` / `box1` / `box2` / `qdrant` / `arango` |

### 失敗排查

| 測試紅燈 | 含義 | 處理 |
|---|---|---|
| `test_breaker_opens_after_threshold_failures` 失敗 | `failure_threshold` 不是 3，或 state machine 沒切到 `open` | 對齊 Audit §7.3 規格 |
| `test_half_open_allows_probe_and_recovers` 失敗 | `reset_timeout` 後沒進 half_open，或 probe 成功未回 `closed` | 檢查 timer 與 state 轉移 |
| `test_kv_budget_over_threshold_rejects_with_retry_after` 失敗 | 沒抛 `KvPoolFull(retry_after_seconds=2, http_status=503)` | 對齊 §7.3 KV 池告警契約 |
| `test_pick_base_url_tiered_by_mode` 失敗 | mode_id ∈ {tot, ddtree} 沒釘 Box 1，或 ASR 沒釘 Box 2 | 檢查 `endpoint.pick_base_url` 的 `routing_policy=tiered` 分支 |
| `test_concurrency_decreases_available_budget` 失敗 | in-flight 沒 reservation → 出現雙花 / OOM 風險 | 在 `guarded_call` 加 in-flight counter，計入 budget |

