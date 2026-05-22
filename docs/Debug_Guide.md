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
OAAO_ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8103 \
OAAO_ORCH_SHARED_SECRET=oaao_dev_shared_secret \
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
