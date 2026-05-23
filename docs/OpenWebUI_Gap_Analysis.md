# OpenWebUI Gap Analysis — oaao.ai 對標、缺口、超越點

> **基準**：Open WebUI（v0.5+，2026 Q1）— self-hosted ChatGPT-like 前端、Pipelines / Functions / Tools 三大插件軸、RAG / Web Search / Channels / Knowledge / Memory、OpenAI-compatible Tool Servers、Model Management UI
> **本系統**：oaao.ai-v1（Razy + FastAPI orchestrator + Gemma 4 31B / 26B-A4B / E4B + Qwen ASR + bge-m3 + Arango + Qdrant）
> 配套：[Audit_Report.md Phase 7](./Audit_Report.md) · [Evolution_System_Design.md](./Evolution_System_Design.md) · [Manus_Gap_Analysis.md](./Manus_Gap_Analysis.md)

---

## 1. 定位差異（重要前提）

| 維度 | Open WebUI | oaao.ai-v1 |
|---|---|---|
| 產品形態 | **通用 LLM 前端**（接任何 OpenAI-compatible backend） | **垂直智能應用平台**（vault 知識庫 + live meeting + agent pipeline） |
| 核心價值 | 可擴充的對話 UI + 插件市集 | 規劃-執行-反思的 agent 框架 + 自我演化 |
| 模型策略 | 模型不可知（Ollama / OpenAI / Anthropic 都接） | 為特定模型棧（Gemma 4 family + Qwen ASR）優化 |
| 多租戶 | 單實例多用戶（內建 RBAC） | Razy 多站點（distributor）但單站單組織 |
| 主要使用者 | 想自己 host ChatGPT 的個人 / 小團隊 | 需要可審計 agent + 知識沉澱的中型組織 |

**結論**：兩者不是 1:1 競品，是「**廣度產品 vs 深度產品**」。oaao.ai 不該追 Open WebUI 的廣度（會稀釋焦點），而該借用它的**插件抽象**並在**垂直深度**勝出。

---

## 2. 能力矩陣對照

> 🟢 ≈ 已對齊或接近｜🟡 缺口但有路徑｜🔴 缺口需重投入｜⭐ 我們可以超越的點｜⚪ 戰略性放棄

### 2.1 對話 / UI 層

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 1 | 多模型切換 UI | ✅ 模型下拉 + per-chat 切換 | ❌ 後端 `purpose_allocation` 固定 | 🟡 | Phase 9 mode_id × purpose_id 暴露到 chat header |
| 2 | 多模型同時對話（side-by-side） | ✅ Native | ❌ | 🔴 | 戰略放棄 — 與 agent 路線衝突 |
| 3 | Chat 分支 / 編輯重發 | ✅ | 🟡 訊息可編輯但無分支樹 | 🟡 | Phase 11 UX |
| 4 | Markdown / LaTeX / Mermaid 渲染 | ✅ | ✅ RazyUI 已支援 | 🟢 | — |
| 5 | Code Artifact / 預覽 | ✅ HTML preview | 🟡 程式區塊有，無 iframe sandbox | 🟡 | Phase 11+ |
| 6 | 語音輸入 / 輸出 | ✅ Whisper + TTS | ✅ Qwen ASR；TTS ❌ | 🟡 TTS 缺 | Phase 10 評估 |
| 7 | Channels（群組 / 公開頻道） | ✅ | ❌ | ⚪ | 戰略放棄 — live-meeting 已覆蓋協作需求 |
| 8 | Mobile / PWA | ✅ | 🟡 響應式但無 PWA | 🟡 | Phase 12 |

### 2.2 插件系統（**Open WebUI 的核心競爭力**）

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 9 | **Pipelines**（OpenAI proxy 中間層） | ✅ 任意 Python 中間件接入請求／回應流 | 🟡 post-stream queue（單向）+ purpose hook | 🟡 部分對齊 | 文件化 `purpose_hook` 為 Pipeline 等價物 |
| 10 | **Functions**（內嵌 Python，無外部服務） | ✅ Filter / Pipe / Action 三型 | 🟡 MicroSkill 寫死 Python；無 UI 上傳 | 🟡 | Phase 9 SkillsManager（UI 上傳 + sandbox 載入） |
| 11 | **Tools**（OpenAPI 工具伺服器） | ✅ 任何 OpenAPI 服務直接成 function call | ❌ | 🔴 高價值 | **Phase 9 P0** — 加 `tool_servers` 軸 |
| 12 | 插件市集 / Community | ✅ openwebui.com/functions | ❌ | ⚪ | 戰略放棄 — 我們是垂直系統不做市集 |
| 13 | 插件版本化 / 灰度 | 🟡 手動 | ❌ | 🟡 | Phase 11 配合 evolution_patches |
| 14 | 插件熱重載 | ✅ | ❌ Razy 需 cleanup | 🟡 | Phase 9 SkillsManager 內建 |

### 2.3 知識 / RAG / 記憶

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 15 | Knowledge Collection（檔案集 → RAG） | ✅ 拖拉上傳 + 自動切片 | ✅ Vault + bge-m3 + bge-reranker-v2 | 🟢 對齊 | — |
| 16 | 多 Embedding 選擇 | ✅ UI 可切 | 🟡 後端可換但無 UI | 🟡 | Phase 10 |
| 17 | Hybrid Search (BM25 + dense) | ✅ | ✅ + Graph rail | **⭐ 超越** | — |
| 18 | Graph RAG | ❌ | ✅ `vault_graph_rag.py` 雙軌 | **⭐ 超越** | — |
| 19 | Reranker | ✅ | ✅ bge-reranker-v2-m3 | 🟢 對齊 | — |
| 20 | Web Search 工具 | ✅ Brave / SearXNG / Google | ❌ | 🟡 | Phase 10 加 `web_search` tool_server |
| 21 | Memory（跨對話） | ✅ 簡單 key-value | ✅ Arango run history + vault summary | **⭐ 超越** | — |
| 22 | Citations / Evidence | ✅ | ✅ envelope `evidence[]` | 🟢 對齊 | — |
| 23 | 知識自我演化 | ❌ | ✅ Phase 11 演化迴圈 | **⭐ 超越（規劃）** | Phase 11 |

### 2.4 模型 / 推論治理

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 24 | 多 backend 接入 | ✅ Ollama / OpenAI / Anthropic / LiteLLM | 🟡 透過 endpoint.py + Razy purpose_allocation | 🟡 | Phase 10 補 LiteLLM-compat shim |
| 25 | 模型管理 UI（下載 / 卸載） | ✅ Ollama 整合 | ❌ vLLM 由 ops 管 | ⚪ | 戰略放棄 — 我們不做 self-serve hosting |
| 26 | 多模型協同（不同步驟用不同模型） | ❌ | ✅ E4B coach + 31B main + 26B-A4B fast | **⭐ 超越** | — |
| 27 | KV 池治理 | ❌ | ✅ Phase 8 `kv_pool_guard` | **⭐ 超越** | — |
| 28 | Circuit Breaker | ❌ | ✅ Phase 8 規格 | **⭐ 超越** | — |
| 29 | Speculative Decoding | ❌（看 backend） | ✅ E4B → 31B draft | **⭐ 超越（硬體）** | — |
| 30 | 兩台 GB10 failover | ❌ | ✅ `pick_base_url` tiered | **⭐ 超越** | Phase 10 |

### 2.5 Agent / 自主性

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 31 | 多輪自主規劃 | ❌（單輪 tool call） | 🟡 planner + report_after | 🟡 | Phase 8 ToT/DDTree |
| 32 | Self-Reflection | ❌ | 🟡 Phase 8 ACCS-triggered | 🟡 | Phase 8 |
| 33 | Skill Crystallization | ❌ | 🟡 Phase 9 | 🟡 | Phase 9 |
| 34 | Action Function（UI 按鈕觸發 LLM 動作） | ✅ | 🟡 RazyUI bubble action | 🟡 | Phase 10 對齊 |
| 35 | 工具串接（Tool A → Tool B） | 🟡 模型自決 | ✅ Planner 顯式編排 | **⭐ 超越（可控性）** | — |

### 2.6 多租戶 / 治理

| # | 能力 | Open WebUI | oaao.ai-v1 | 差距 | 路徑 |
|---|---|---|---|---|---|
| 36 | RBAC | ✅ Admin / User / Pending | ✅ Razy ACL + module 權限 | 🟢 對齊 | — |
| 37 | Audit Log | ✅ | ✅ StreamEnvelope + run history | **⭐ 超越（顆粒度）** | — |
| 38 | SSO / OAuth | ✅ Google / Microsoft / OIDC | 🟡 Razy 有 auth 但需配置 | 🟡 | Phase 11 |
| 39 | 計費 / Quota | 🟡 | ❌ | ⚪ | 戰略放棄 — B2B 場景不需 |
| 40 | 部署 / 容器化 | ✅ 一行 docker | 🟡 多服務 compose | 🟡 | Phase 11 簡化 |

---

## 3. 結構差距詳解（核心三點）

### Gap O-1 — Tool Servers（OpenAPI as Tools）⚠️ P0

Open WebUI 最強的差異化：**任何 OpenAPI 服務 → 模型立即可 function-call**。

當前 oaao.ai 的 tool 暴露在 `chat_runs.py` 透傳 `tools` 欄位，但沒有：

1. OpenAPI spec → OpenAI tool schema 自動轉換器
2. Tool Server 註冊 UI / 設定檔
3. Per-purpose 的 tool 白名單

**建議實作**（Phase 9 同步）：

```python
# python/oaao_orchestrator/tools/openapi_adapter.py
def openapi_to_openai_tools(spec: dict) -> list[dict]:
    """OpenAPI 3.x spec → OpenAI tools[]."""
    ...

# Razy 端：增 tool_server.register hook
$this->trigger('tool_server.register')->resolve([
    'id' => 'web_search',
    'base_url' => 'https://searxng.internal/',
    'openapi_url' => '/openapi.json',
    'allowed_purposes' => ['chat', 'planning'],
]);
```

對應 Audit §7.4 已預留 `tool_server.register` 槽位，**僅需補 OpenAPI adapter**。

### Gap O-2 — Functions UI（Filter / Pipe / Action）⚠️ P1

Open WebUI Functions 三型：

| 型別 | 觸發點 | oaao.ai 等價 |
|---|---|---|
| **Filter** | 請求進 / 回應出時改寫 | `purpose_hook` (進) + post-stream queue (出) |
| **Pipe** | 取代整個 model call | 自定 `agent_kind` |
| **Action** | UI 按鈕觸發 | RazyUI bubble action button |

**差距**：機制有，但**沒有 UI 上傳 + 沙箱載入**。

**建議實作**（Phase 9 Skills Manager 統一處理）：

```text
[Admin UI] → upload my_filter.py
    → 沙箱驗證（無 dangerous import）
    → 寫入 site/scripts/
    → trigger('post_stream_plugin.register') 自動掛上
    → 灰度（10% traffic）
    → Daily Report 看 ACCS 影響
    → 全量 or rollback
```

### Gap O-3 — Web Search 整合 ⚠️ P2

Open WebUI 內建 7+ 搜尋 backend。oaao.ai 完全沒有 web search 軸。

**最小路徑**：

1. Phase 10 加 `tools/web_search.py`（簡單 SearXNG client）
2. 註冊為 `tool_server.register`
3. 在 `vault_rag` agent 後追加：vault 命中率 < 0.3 → 自動觸發 web search

---

## 4. 我們可以超越 Open WebUI 的點（深化）

### ⭐ O-S1 — 多模型協同 vs 單模型黑箱

Open WebUI 一條對話只用一個模型；oaao.ai 一個 run 內：

- IQS 評分 → E4B (Box1, 5GB, 50ms)
- 規劃 → E4B (Box1, planning purpose)
- 主答 → 31B FP8 (Box1, heavy mode) **或** 26B-A4B FP8 (Box2, fast mode)
- ACCS 評分 → E4B (Box1)
- Summary → E4B (Box2)

→ **同一輸入耗用 3 個模型協同**，且各模型可獨立替換。Open WebUI 架構無法表達此編排。

### ⭐ O-S2 — Graph RAG + Hybrid 雙軌

`vault_graph_rag.py` 同時走：

1. Dense vector（bge-m3）
2. BM25
3. **Graph traversal**（Arango edges：實體 / 文件 / 對話三類節點）

Open WebUI 的 RAG 僅 dense + BM25。對「多文件交叉引用」（e.g.「A 報告引用 B 章節中的數據是什麼？」）我們可給精確 evidence chain。

### ⭐ O-S3 — Agent 可控性

Open WebUI 完全依賴 LLM 自決工具串接；oaao.ai 是 **Planner 顯式 DAG**：

- 工具順序審計：每步 `agent_kind` 在 StreamEnvelope
- 失敗點精確（哪個 agent_kind 拋什麼）
- A/B 測試容易（換 planner_llm 不換工具）

對企業/合規場景是硬需求。

### ⭐ O-S4 — Hook 隔離 + Hard Rules

Audit §7.1 的 HR-1..HR-4（registry only / cleanup mandatory / no cross-require / no PHP SSE）+ import lint 是**架構級的安全網**。Open WebUI 的 Functions 隨意 import 任何 Python module（攻擊面大）。

### ⭐ O-S5 — 自我演化迴圈

Open WebUI 沒有「系統自己改自己 prompt」的能力；我們 Phase 11 Daily/Weekly Report + `evolution_patches` + auto-rollback 是質變差異（見 [Evolution_System_Design.md §10](./Evolution_System_Design.md)）。

### ⭐ O-S6 — 可審計顆粒度

每 run 的 StreamEnvelope 包含：`iqs_score` / `accs_score` / `tool_chain` / `evidence` / `circuit_state` / `kv_usage` / `latency_breakdown`。Open WebUI 只記 message + model name。

合規場景（金融 / 醫療 / 政府）這是門檻。

---

## 5. 戰略性放棄（不追隨 Open WebUI 的點）⚪

| 軸 | 放棄原因 |
|---|---|
| 模型下載 UI | 我們是企業部署，模型由 ops 管，self-serve 增加攻擊面 |
| 公開 Channel 群聊 | live-meeting 已覆蓋協作；Channel 與 agent 框架衝突 |
| 插件市集 | 我們是垂直系統，插件需審核（Skills Manager 灰度），不做 community 上架 |
| 多模型 side-by-side | 與 agent 編排路線衝突；用戶體驗訴求不同 |
| 計費 / Quota / Stripe | B2B 場景由合約計算，不嵌應用層 |
| Ollama 整合 | vLLM + GB10 是定論硬體棧，不維護替代 backend |

---

## 6. 優先級對照表（P0 / P1 / P2）

| 優先 | 缺口 | 對標項 | 落地 Phase | 預估 |
|---|---|---|---|---|
| **P0** | OpenAPI Tool Servers | Open WebUI Tools | Phase 9 | 加 `openapi_adapter.py` + Razy `tool_server.register` |
| **P0** | 模型切換 UI 暴露 | mode 下拉 | Phase 9 | chat header 加 mode_id × purpose_id 選單（後端契約已備） |
| **P1** | Functions UI（上傳 / 灰度） | Functions | Phase 9 + Phase 11 | Skills Manager + evolution_patches |
| **P1** | Web Search Tool | Web Search | Phase 10 | `tools/web_search.py` + SearXNG |
| **P1** | TTS（語音輸出） | TTS | Phase 10 | 評估 piper / xtts |
| **P2** | LiteLLM-compat shim（接外部模型） | 多 backend | Phase 10 | OpenAI-compatible proxy 層 |
| **P2** | SSO / OIDC | Auth | Phase 11 | Razy auth 模組擴充 |
| **P2** | PWA / Mobile | Mobile | Phase 12 | 配合 RazyUI |
| **P2** | Code Artifact preview | Artifact | Phase 11 | RazyUI iframe sandbox |
| ⚪ | 模型管理 UI / Channels / 插件市集 / 計費 | — | — | 戰略放棄 |

---

## 7. 落地建議：先補 Tool Servers 一軸

**理由**：

1. 用工作量最小 — 加一個 adapter + 一個 Razy hook，重用既有 tools 透傳鏈
2. 解鎖最多場景 — Web Search、Confluence、Jira、自家 OpenAPI 全部進來
3. 與 Phase 9 Skills Manager 同源 — Functions 是 in-process，Tools 是 out-of-process，兩個入口共用 UI

**最小 PR 範圍**：

```text
python/oaao_orchestrator/tools/openapi_adapter.py     # 新增
python/oaao_orchestrator/tools/registry.py            # 新增（per-purpose 白名單）
python/tests/test_openapi_adapter.py                  # 新增（5 個案例：path/method/body/auth/error）
backbone/sites/oaaoai/.../module.php                  # 加 tool_server.register listener
docs/Audit_Report.md §7.4                             # 已預留，補 OpenAPI 細節
```

---

## 8. 三句話總結

1. **Open WebUI 是廣度產品（多 backend × 多插件），oaao.ai 是深度產品（agent × 演化 × 知識）**，不需追平所有 UI 功能。
2. **必須補的只有一條軸**：OpenAPI Tool Servers（Gap O-1，P0）— 因為這直接擴大模型可呼叫的工具空間，與我們 agent 路線**疊加而非競爭**。
3. **我們的不對稱優勢**在 ⭐ O-S1..O-S6：多模型協同、Graph RAG、Agent 可控性、Hook 隔離、自我演化、審計顆粒度。Phase 8–11 全部落地後，在企業 / 合規 / 知識密集場景對 Open WebUI 形成**結構性勝出**。
