# oaao.ai-v1 — 測試與 Smoke 目錄

說明每一項 **自動檢查／pytest／HTTP smoke** 在驗證什麼，以及 **通過時的預期結果**。  
執行入口對照 [Debug_Guide.md](./Debug_Guide.md)、[Test_Suite/README.md](../Test_Suite/README.md)。

---

## 1. 總覽：哪裡跑什麼

| 層級 | 入口 | CI（`.github/workflows/oaao-ci.yml`） | 本機 |
|------|------|----------------------------------------|------|
| **Sandbox 總入口** | `scripts/sandbox_check.sh` | 子集見下（`--all` 僅本機） | `--quick` / `--python` / `--docker` / `--all` |
| 模組隔離稽核 | `scripts/audit_cross_module_requires.sh` | `bridge-and-contract`（`--gate`）、`audit-full`（全樹） | 同上 |
| PHP 語法 | `scripts/php_lint_oaaoai.sh` | `bridge-and-contract` | 或 `docker compose exec web …` |
| Bridge + Hook + namespace | `scripts/ci_check.sh` | bridge job（3 pytest + lint） | 同上 |
| Orchestrator HTTP | `scripts/oaao_orchestrator_smoke.sh` | `orchestrator-smoke`（`app:app` + `OAAO_SMOKE_START_CHAT_RUN=1`） | 需先起 uvicorn |
| Python 單元／整合 | `cd python && python -m pytest tests/ -q` | **僅** 上列 2 個 pytest 檔 | 建議 Python **3.12+** |
| PHP 單元測試 | — | **無** | — |

**CI 三個 job 全綠** = gate 0 違規 + 全樹 0 P0 + bridge 契約 + hook 韌性 + sidecar health/chat `run_id`。

---

## 2. Shell 腳本與 Smoke

### 2.0 `scripts/sandbox_check.sh`（推薦：改程式後先跑）

在人工點 UI 之前，用一條指令掃一輪常見錯誤（語法、跨模組 require、bridge 契約、PHP `use` 遺漏、可選全量 pytest／Docker smoke）。

| 模式 | 內容 | 預期結果 |
|------|------|----------|
| （預設） | `php_lint` + audit gate + audit full + 3 個 pytest（bridge、hook、**namespace/use**） | 最後 `sandbox_check: OK` |
| `--python` | 上述 + `pytest tests/` 全 suite | 全綠（需 `requirements-orchestrator-app.txt`） |
| `--docker` | 上述 + orchestrator `/health` + web `/health` + `oaao_orchestrator_smoke.sh`（含 chat `run_id`） | compose 已 `up`；sidecar/web 可連 |
| `--all` | `--python` + `--docker` | 本機完整 pre-flight |

```bash
bash scripts/sandbox_check.sh
bash scripts/sandbox_check.sh --all   # 送 PR / 大改前
```

**能抓到**：parse error、`require` 違規、bridge 檔案缺方法、**`Module\oaao\*` 控制器未 `use oaaoai\*` 類別**（如 `UiqePurposeConfig`）、Python 單元回歸。  
**不能取代**：登入 UI、真實 LLM、Qdrant embed、FunASR 麥克風、完整 SSE 內容校驗。

---

### 2.1 `scripts/audit_cross_module_requires.sh`

| 模式 | 掃描範圍 | 驗證內容 | 預期結果 |
|------|----------|----------|----------|
| `--gate` | `chat`、`live-meeting`、`slide-designer` 模組 PHP | 不得 `require_once` **同層其他模組** 的 `library/` 或 `controller/`（peer 隔離） | 退出碼 **0**；stdout：`OK: gate modules … have no peer cross-module …`；**允許** 直接 require `core`、`auth` |
| （預設全樹） | `backbone/sites/oaaoai/oaaoai/**/*.php` | 同上，另允許 `endpoints/.../event/*`、`auth/.../controller/`、`core/.../controller/` 等註冊路徑 | 退出碼 **0**；`OK: no P0 cross-module …`；違規時列 `P0: <檔>` 並 **exit 1** |

**不通過時**：輸出含 `P0:` 的檔案與 `require_once` 行；應改為 `$this->api('模組')` bridge。

---

### 2.2 `scripts/ci_check.sh`

依序執行：

1. `audit_cross_module_requires.sh --gate`
2. `pytest tests/test_orchestrator_bridge_contract.py tests/test_pipeline_hook_resilience.py`（無 pytest 時僅跑 bridge 契約的 inline 執行）

**預期結果**：最後一行 `ci_check: OK`；任一子步失敗則 **exit 1**。

---

### 2.3 `scripts/oaao_orchestrator_smoke.sh`

環境變數：

| 變數 | 預設 | 說明 |
|------|------|------|
| `OAAO_ORCHESTRATOR_INTERNAL_URL` | `http://127.0.0.1:8103` | Sidecar base URL |
| `OAAO_ORCH_SHARED_SECRET` | `oaao_dev_shared_secret` | `X-OAAO-Internal-Token` |
| `OAAO_SMOKE_START_CHAT_RUN` | `0` | `1` 時才 POST chat run |

| 步驟 | 驗證內容 | 預期結果 |
|------|----------|----------|
| `GET /health` | Sidecar 進程可連、FastAPI 路由存在 | `curl -fsS` 成功；JSON 含 `ok`（完整 app 另含 service 等欄位） |
| `GET /v1/funasr/status`（可選） | FunASR 狀態端點 | 有 token 且服務存在則回 JSON；否則印 `(skipped)`，**不** 讓腳本失敗 |
| `POST /v1/runs/chat`（僅 `OAAO_SMOKE_START_CHAT_RUN=1`） | 最小 chat run 受理：fixed planner、`vault_rag`、假 endpoint | HTTP 200；JSON **`run_id` 非空**；有則印 `stream_token_ok`。body 見腳本內 `ci-smoke` payload |
| 未設 `OAAO_SMOKE_START_CHAT_RUN` | 僅 health 煙測 | 退出碼 **0**（提示可設 env 啟用 chat） |

**不通過時**：`FAIL: /v1/runs/chat did not return run_id` 或 curl 非 2xx（`-f`）。

**注意**：smoke **不** 等待 SSE 完成、**不** 呼叫真實 LLM（`base_url` 指向不可達 host 僅驗證排程／回傳結構）。

---

### 2.4 `python/oaao_orchestrator/health_app.py`（歷史／輕量）

僅 `GET /health` → `{"ok": true, "service": "oaao_orchestrator"}`。  
現行 CI 使用 **`oaao_orchestrator.app:app`** 完整 lifespan；此檔保留作最小依賴煙測參考。

---

## 3. CI 內 pytest（必跑）

### 3.1 `test_orchestrator_bridge_contract.py`（靜態 PHP 契約）

不啟動 PHP／HTTP；讀取 repo 內源碼字串。

| 測試 | 驗證什麼 | 預期結果 |
|------|----------|----------|
| `test_chat_orchestrator_api_library_exists` | `ChatOrchestratorApi.php` 存在且含 sidecar HTTP 方法 | 含 `postInternalJson`、`startChatRun` |
| `test_chat_controller_publishes_bridge_commands` | `chat.php` 對外 bridge | 含 `postOrchestratorInternalJson`、`buildLiveMeetingOrchestratorExtras`、`vaultRetrievalProfilesForVaultIds` |
| `test_vault_retrieval_profiles_module_local` | Vault 檢索設定留在 vault 模組 | 含 `VaultArangoResolver`、`fromVaultIds` |
| `test_send_does_not_require_vault_glossary_library` | `send.php` 不直接 require vault glossary 檔 | 無 `VaultGlossary.php`；有 `vaultRetrievalProfilesForVaultIds` |
| `test_slide_designer_publishes_template_api` | slide-designer 模組 API | 含 `resolvePublishedTemplate`、`orchestratorSlideDesignerBase`、`enrichAndSyncAssistantSlideMeta` |
| `test_chat_conversation_material_no_slide_registry_require` | 材料解析不 require slide registry 檔 | 無 `SlideProjectRegistry.php`；有 `resolveSlideMaterialByProjectId` 或 `slideApi` |
| `test_assistant_patch_uses_slide_api` | assistant patch 走 bridge | 含 `enrichAndSyncAssistantSlideMeta`；無 `SlideProjectRegistry.php` |
| `test_send_uses_endpoints_api` | RAG 設定走 endpoints | 含 `resolveOrchestratorVaultRagConfig`；無 `CanonicalEndpointsRepository` |

---

### 3.2 `test_php_namespace_use_contract.py`（PHP `use` 遺漏）

| 測試 | 驗證什麼 | 預期結果 |
|------|----------|----------|
| `test_module_controllers_import_oaaoai_library_classes` | `namespace Module\oaao\{mod}` 的 `controller/*.php` 使用同模組 `library` 類別時必有 `use oaaoai\{mod}\Class` 或 `\oaaoai\…` | 0 違規；否則列檔案與類別名 |

---

### 3.3 `test_pipeline_hook_resilience.py`（Agent registry）

| 測試 | 驗證什麼 | 預期結果 |
|------|----------|----------|
| `test_failing_agent_returns_failed_result_not_exception` | 已註冊 agent 拋錯時 registry 行為；未知 `agent_kind` | **已知 agent**：`pytest.raises(RuntimeError, match="simulated agent failure")`（文件化：registry 目前會傳播，executor 應 catch）。**未知 kind**：`AgentResult(success=False)`，`error` 含 `unknown_agent_kind` |

---

## 4. Python pytest（本機／完整套件；CI 未全跑）

依賴：`python/requirements-ci.txt`（輕量）或 `requirements-orchestrator-app.txt`（與 sidecar 一致）。  
執行：`cd python && python -m pytest tests/<檔或目錄> -q`

### 4.1 Task pipeline（聊天 Run 編排）

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_task_pipeline_phase0.py` | Phase 常數、RunPlan payload、registry 註冊／未知 kind | `PHASE_TASK`∈`PHASES`；task list 2 項且 `pending`；未知 agent → `success=False`；stub `slides` → `success=True` |
| `test_task_pipeline_phase1.py` | `build_default_run_plan` | 無 vault/附件 → 僅 `LLM_STREAM`；有 vault+附件 → `[VAULT_RAG, ATTACHMENTS, LLM_STREAM]` 且 index/total 正確 |
| `test_task_pipeline_phase2.py` | Planner 模式、LLM JSON 正規化、plan 合併 | `allowed_agents` 解析；request/env `planner_mode`；stream 最後一塊覆蓋 planner JSON；`insert_before_llm`；reindex tasks |
| `test_task_pipeline_phase3.py` | VaultRagAgent、SSE agent_task | `vault_rag` kind/view；registry 含 agent；mock augment 後 `success=True`、system 訊息插入、≥1 條 `PHASE_RAG` progress 含標題 |
| `test_task_pipeline_phase4.py` | 垂直 stub agents | 各 `STUB_AGENT_DEFS` 已註冊；`sandbox_code` 發 `PHASE_SANDBOX` progress；`slides` 回傳 pptx mime artifacts |
| `test_task_pipeline_phase5.py` | 取消、since_seq 重播、取消 emit | `request_cancel()` 設 flag；`snapshot_since` 含 task STATUS/START/END；取消後 checklist 更新 |

---

### 4.2 Planner／Agent catalog

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_fast_chat_planner.py` | 快速路徑跳過 LLM planner | 一般 Q&A `needs_multi_agent_turn` false；錢包召回含 `vault_rag`；傅立葉通識無 vault 時僅 compose |
| `test_planner_agent_catalog.py` | PHP 合併的 agent catalog | request 覆寫 builtin；guide 只列 allowed；system prompt 含 guide |
| `test_planner_slide_action.py` | `slide_action` 合併、續寫、reuse grounding | regenerate/continue 意圖；regenerate 跳過 fanout；reuse 強制 vault_rag；turn 重用 prior material |

---

### 4.3 Vault RAG

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_vault_graph_rag_citations.py` | 通識 vs 手冊查詢、引用篩選 | 傅立葉/英文 Fourier → general knowledge；Handbook Vol.3 → 需 grounding、boost 查詢；GK 問題且 `wants_gk=True` 時 citations 為 `[]` |

---

### 4.4 Live meeting

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_live_meeting_session.py` | Session 目錄與 stop | `session_dir`/`audio_dir`/`meta` 存在；stop 後 load 狀態 `stopped` |
| `test_live_meeting_sse_hub.py` | SSE hub 訂閱重播 | append 後 subscribe 收到含 `hello` 或 `live_transcript` 的 chunk |
| `test_live_meeting_audio_store.py` | 分段錄音寫檔 | close callback 被呼叫；輪替產生多檔 |
| `test_live_meeting_live_stats.py` | RAG live stats payload | 首次 lookup delta=total；重複 delta=0；來源增多 delta 遞增 |
| `test_live_meeting_bubble_engine.py` | 氣泡節奏與抽取 | debate/meeting/unknown cadence 秒數；glossary 關鍵字與問句類型氣泡 |
| `test_live_meeting_bubble_rag.py` | 氣泡 vault 查詢 | 空 query → `materials=[]`、`passage_count=0` |
| `test_glossary_hotwords.py` | 詞彙表 → DashScope hotwords | 去重順序；JSON 含 `OAAO` |

---

### 4.5 Post-stream（IQS / ACCS）

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_post_stream_schemas.py` | 外掛 JSON 解析 | 合法 IQS/ACCS 解析成功；非法 → `None` |
| `test_post_stream_prompt.py` | Worker prompt 路徑與替換 | plugin→md 對應；變數替換；repo `materials` 路徑解析 |
| `test_post_stream_queue.py` | 佇列 spawn | 有 UIQE endpoint 時 enqueue `iqs`+`accs` 各一 job；無 endpoint 則 queue 空；meta 含 conversation/materials_count |

---

### 4.6 Slide designer／簡報 pipeline

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_slide_fanout.py` | 多頁 fan-out／續寫 | 從 user 訊息偵測頁數；展開 parallel pages；continuation 跳過 fanout；task list 分組 |
| `test_slide_designer_ask.py` | 建 deck 前 `requires_ask` | template inject / planner row 設 ask 旗標 |
| `test_slide_pipeline_blocks.py` | Preview pipeline blocks | strip/deck block 形狀；與 `run_executor` 合併契約 |
| `test_slide_project_store.py` | 專案目錄與無 LLM build | shell 目錄結構；`build_deck_without_llm` 產出 |
| `test_slide_canvas.py` | 固定 canvas HTML | 注入 canvas；fallback 通過驗證；主題/layout 多樣化 |
| `test_slide_html_sandbox.py` | HTML 沙箱 | 最小文件通過；fence/缺 body 拒絕 |
| `test_outline_markdown.py` | Manus 風 outline | 解析 `# N -` 投影片；format/merge script |
| `test_template_registry.py` | JSON 版型目錄 | 載入 layouts/themes；CSS token；diversify 讀 plan |
| `test_template_pages.py` | PPTX profile → page plan | FAQ layout；slot seeds；apply 鎖 layout |
| `test_template_page_match.py` | 頁面↔模板匹配 | 標題避開錯誤 agenda 模板；content match；不複製 fashion seeds |
| `test_template_micro_skills.py` | Micro skills 正規化 | minimal normalize；尊重 page picks |
| `test_micro_skills_registry.py` | Skills 與 template 綁定 | bound id；catalog from request |

---

### 4.7 PPTX／材料

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_pptx_master.py` | Master HTML／geometry／placeholder | bullets CSS；positioned slots；清 placeholder；decor inject/strip |
| `test_pptx_materials.py` | CP2 materials unpack | 預設 enabled；manifest 單色樣本 |
| `test_pptx_typography.py` | 語系與排版提示 | zh-Hant/en 偵測；CJK mismatch hints；deck style 覆寫 |
| `test_slot_content.py` | 無 LLM slot merge | layouts 宣告 slots；FAQ/三卡/標題區塊 merge 正確 |

---

### 4.8 基礎設施／其他

| 檔案 | 驗證什麼 | 預期結果（摘要） |
|------|----------|------------------|
| `test_run_principal.py` | Run principal HMAC（PHP 對齊） | issue/verify roundtrip；`require_for_request` 與 payload 一致 |
| `test_async_bridge.py` | LibreOffice 互斥 | asyncio lock；`run_soffice_job` 序列化兩 job |
| `test_dashscope_asr_parse.py` | DashScope ASR URL／模型旗標 | Qwen realtime 判斷；WS URL 解析；streaming flag |

---

## 5. 輔助：`python/tests/support/llm_mock.py`

非獨立測試；提供 **可重播的 LLM/planner mock**（`LlmMock`、`planner_json_stub`）供 phase2／planner 類測試使用。

---

## 6. 建議執行指令

```bash
# 改程式後建議（比 ci_check 多 full audit + 可選 pytest/docker）
bash scripts/sandbox_check.sh

# 與 CI bridge job 對齊的子集
bash scripts/ci_check.sh

# 全樹模組隔離（與 CI audit-full 相同）
bash scripts/audit_cross_module_requires.sh

# 全部 Python 測試（需 3.12+ 與 orchestrator 依賴）
pip install -r python/requirements-orchestrator-app.txt
cd python && python -m pytest tests/ -q

# Orchestrator smoke（需 sidecar）
cd python && python -m uvicorn oaao_orchestrator.app:app --host 127.0.0.1 --port 8103 &
OAAO_SMOKE_START_CHAT_RUN=1 OAAO_ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8103 \
  bash ../scripts/oaao_orchestrator_smoke.sh
```

---

## 7. 尚未納入自動化（規劃）

見 [Audit_Report.md](./Audit_Report.md) §8、[Test_Suite/README.md](../Test_Suite/README.md)：

| 項目 | 目的 | 現狀 |
|------|------|------|
| E2E：Message In → orchestrator → SSE Out | 端到端串流 | 未實作 |
| PHP Register 快照測試 | `chat_pipeline.register` 等合併結果 | 未實作 |
| 統一 `Mock_Core` in-process 全鏈 | PHP 不啟 HTTP 的整合 | 未實作 |

---

## 8. 變更本文件時

新增 `python/tests/test_*.py` 或 CI/smoke 步驟時，請同步更新對應章節的「驗證什麼／預期結果」列。
