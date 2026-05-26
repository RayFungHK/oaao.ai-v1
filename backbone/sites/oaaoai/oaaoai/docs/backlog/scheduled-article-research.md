# Backlog：排程 Article Research — 定時抓文 → Vault RAG → 命中通知

> **狀態**：Phase A **已實作**（2026-05-22）— 手動 Run、`url`/`rss`/`blog`/`arxiv`、雙檔 `{slug}.md` + `{slug}_summary.md`、Vault embed queue  
> **待做**：cron 排程、keyword 命中通知、Playwright、圖片理解  
> **目標**：使用者定義一或多 **來源**（URL / RSS / sitemap / API），依 **cron** 定時 fetch 新內容 → 去重 → 寫入指定 **Vault folder** → 自動 **embed** → 依 **match 規則** 判定「命中」→ **in-app notification**（可選 email）。  
> **硬性規則**：長時間 fetch / LLM 判斷 / embed 在 **Python orchestrator** 或專用 worker；PHP 負責 CRUD、ACL、排程設定、Vault job enqueue、通知寫入。

**相關**：[vault-rag-scope-controls.md](./vault-rag-scope-controls.md) · [credit-top-up-and-consumption.md](./credit-top-up-and-consumption.md) · [Pipeline_Index_vs_Static.md](../Pipeline_Index_vs_Static.md) · `docs/MIGRATION_LEGACY_OAAO.md`（Legacy Corpus/Workflow 語意參考）

---

## 2.1 Pipeline 模式（Index vs Static）

> 完整說明見 **[Pipeline_Index_vs_Static.md](../Pipeline_Index_vs_Static.md)**。

| 模式 | 用途 | 例 |
|------|------|-----|
| **Index / List** | 列表頁每輪出現 **新 link** → discover → 逐 item fetch | `index:https://arxiv.org/list/cs.AI/recent`、RSS |
| **Static** | **同一 URL** 每輪 fetch，以 URL/hash 去重 | 單篇 `arxiv.org/abs/…`、固定文章 URL |

Research 管線：**Discover links → Fetch 正文 → LLM summary → Vault markdown + embed**。Index 來源在 orchestrator `list_candidates_from_source(kind=index)` 實作（v2026-05-22 起支援 arXiv list）。

---

## 1. 背景與動機

| 現況 | 缺口 |
|------|------|
| Vault 手動上傳 + `document_enqueue` → embed job | 無 **定時監控外部來源** |
| Chat **web_search** agent（SearXNG） | 搜尋 snippets，**不**持久化到 Vault |
| Composer 附件 / URL fetch | **未做**（可共用 fetch 管線，見 §6） |
| `NotificationRepository` + 鈴鐺 UI | 無 research 專用 kind / deep link |
| Evolution `evolution_cron_run` | 可複用 **HTTP cron → orchestrator** 模式，非產品 UI |

**使用情境**：法規/新聞/競品 RSS、政府公報 URL 列表、內部 wiki 變更頁；新文章進指定 folder 並可被 Chat RAG 引用；關鍵字或語意命中時通知負責人。

---

## 2. 產品決策（實作前凍結）

| # | 決策 |
|---|------|
| 1 | 新模組代號 **`oaaoai/research`**（或 `vault` 子功能 `scheduled_watch`）— SPA：`workspace/research` |
| 2 | 一 tenant 多 **Watch**；每 Watch 綁定 **一個 vault_id + container_id（folder）** |
| 3 | 來源型態 v1：**RSS/Atom**、**固定 URL 列表**（HTML 正文抽取）、**sitemap**；v2：需登入 / JS 渲染 → Playwright sidecar |
| 4 | 去重鍵：`canonical_url` + `content_hash`（或 `etag` / `last_modified` 若來源提供） |
| 5 | 命中規則 v1：**關鍵字 ANY/ALL**、**regex**、可選 **embedding 相似度** vs 使用者 profile 句；v2：LLM yes/no |
| 6 | 通知：`oaao_notification.kind = research_hit`；payload 含 `watch_id`, `document_id`, `vault_id`, `matched_rule` |
| 7 | 與 Vault RAG scope：寫入 folder 預設 `rag_searchable=1`；若 [vault-rag-scope-controls](./vault-rag-scope-controls.md) 已上線，尊重 `rag_enabled` |
| 8 | 計費：fetch + embed + 可選 LLM match 記 `oaao_usage_event`（對齊 credit backlog） |

---

## 3. 架構（目標）

```text
┌──────────────────┐   cron / manual run   ┌─────────────────────────┐
│ SPA workspace/   │ ────────────────────► │ PostgreSQL               │
│ research         │                       │ oaao_research_watch      │
│ (sources, rules) │                       │ oaao_research_source     │
└──────────────────┘                       │ oaao_research_run        │
                                           └────────────┬────────────┘
                                                        │
                        POST /research/api/run 或 systemd timer
                                                        ▼
                                           ┌─────────────────────────┐
                                           │ orchestrator             │
                                           │ research_worker.py       │
                                           │  fetch → extract → dedupe│
                                           │  → vault document_upload │
                                           │  → embed job (existing)  │
                                           │  → match → notify PHP    │
                                           └─────────────────────────┘
```

**排程觸發**（擇一或並存）：

| 方式 | 說明 |
|------|------|
| **A. systemd timer** | 類 Evolution：`curl -X POST .../research/api/cron_run` + `X-OAAO-Internal-Token` |
| **B. orchestrator asyncio loop** | 與 `vault_job_poll_loop` 同族，每 N 秒掃 `next_run_at` |
| **C. 手動 Run now** | Settings / Research 列表「立即執行」 |

建議 v1：**B + C**（少依賴 host cron）；平台 admin 可再加 A。

---

## 4. 資料模型（草案）

### 4.1 `oaao_research_watch`

| 欄位 | 說明 |
|------|------|
| `watch_id` | PK |
| `tenant_id`, `owner_user_id` | ACL |
| `label` | 顯示名稱 |
| `vault_id`, `container_id` | 寫入 folder |
| `cron_expr` | 例 `0 */6 * * *`；或 `interval_minutes` |
| `is_enabled` | 軟開關 |
| `match_json` | 規則集合（見 §5） |
| `notify_json` | `{ "in_app": true, "email": false, "user_ids": [] }` |
| `last_run_at`, `next_run_at` | 排程 |

### 4.2 `oaao_research_source`

| 欄位 | 說明 |
|------|------|
| `source_id` | PK |
| `watch_id` | FK |
| `kind` | `rss` \| `index` \| `static` \| `url_list` \| `arxiv` \| `sitemap` \| `api` |
| `config_json` | URL、headers、auth ref、CSS selector（HTML）；`source_mode`: `index` \| `static` |
| `fetch_mode` | `http` \| `playwright`（v2） |
| `sort_order` | 多來源順序 |

### 4.3 `oaao_research_run`

| 欄位 | 說明 |
|------|------|
| `run_id` | PK |
| `watch_id` | FK |
| `status` | `queued` → `running` → `done` \| `failed` |
| `started_at`, `finished_at` | |
| `stats_json` | `{ "fetched": 12, "new_docs": 3, "hits": 1, "errors": [] }` |

### 4.4 `oaao_research_item`（去重索引）

| 欄位 | 說明 |
|------|------|
| `watch_id`, `canonical_url` | UNIQUE |
| `document_id` | 對應 `oaao_vault_document` |
| `content_hash`, `first_seen_at`, `last_seen_at` | |

---

## 5. Match 規則（`match_json` 草案）

```json
{
  "mode": "any",
  "rules": [
    { "type": "keyword", "terms": ["SFC", "牌照"], "scope": "title_or_body" },
    { "type": "regex", "pattern": "Article\\s+\\d+", "flags": "i" },
    {
      "type": "embedding_similarity",
      "query_text": "香港證監會持牌人規定變更",
      "min_score": 0.72,
      "purpose_key": "embedding.primary"
    }
  ]
}
```

- **keyword / regex**：fetch 後正文純文字即可。  
- **embedding_similarity**：需 embed 完成後非同步再判（第二 pass job）；命中才補發通知。  
- **LLM match**（v2）：`chat.primary` 結構化 `{ "hit": true, "reason": "..." }`。

---

## 6. Fetch 管線

| 步驟 | 實作 |
|------|------|
| HTTP GET | `httpx` + timeout + SSRF 防護（禁止私網 / metadata IP，除非 admin allowlist） |
| HTML → 正文 | `trafilatura` 或 `readability-lxml` |
| RSS | `feedparser` |
| 二進位 PDF | 既有 vault ingest（可選 v2） |
| JS 站 | **Playwright sidecar**（新 profile，與 [Manus gap](../../../docs/Manus_Gap_Analysis.md) browser sandbox 分離） |

**與 Composer URL fetch 共用**：抽取層可抽成 `oaao_orchestrator/fetch/extract.py`；Research 與 Chat composer 共用，避免雙份邏輯。

---

## 7. Vault / embed 整合

1. Orchestrator 呼叫 PHP **`POST /vault/api/document_upload`**（internal token）或等價 internal helper — metadata 標 `source=research`, `watch_id`, `canonical_url`。  
2. 若 vault `is_enabled=1` → 既有 hook 自動 queue embed；否則 **`document_enqueue`** 手動觸發。  
3. `embed_status=embedded` 後才做 embedding_similarity match（若規則含此類型）。  
4. 文件名稱：`{watch_label}/{YYYY-MM-DD}/{title_slug}.md` 或 `.html` 純文字存檔。

---

## 8. UI（SPA）

| 頁面 | 功能 |
|------|------|
| `workspace/research` | Watch 列表、enabled、cron、上次 run 摘要 |
| Watch 編輯 | 來源列表、vault/folder picker、match 規則、通知對象 |
| Run 詳情 | fetched / new / hits / 錯誤 log；連到 Vault 新文件 |
| 通知點擊 | 開 Vault 文件或 Research run 詳情 |

i18n：`research.*` keys；Settings 側欄可放「Article Research」入口。

---

## 9. 實作分期

### Phase A — 單來源 RSS + Vault 寫入（無 match）

| 任務 | 說明 |
|------|------|
| Schema + PHP CRUD API | `research/api/watch_save`, `watch_list`, `run_now` |
| `research_worker` stub | 拉 RSS → 一篇 markdown → document_upload |
| Run 記錄 + 去重表 | |
| 手動 Run now | |

**驗收**：RSS 有新 item 時 Vault folder 出現新檔並進 embed queue。

### Phase B — Cron + 多來源 + keyword match + 通知

| 任務 | 說明 |
|------|------|
| `next_run_at` scheduler loop | orchestrator |
| URL list + HTML extract | |
| `NotificationRepository::create` research_hit | |
| Watch 列表 UI | |

**驗收**：定時 run；關鍵字命中 → 鈴鐺通知；點通知可開文件。

### Phase C — 進階 match + Playwright + 計費

| 任務 | 說明 |
|------|------|
| embedding_similarity 第二 pass | |
| Playwright fetch_mode | |
| usage / credit debit | |
| Admin 平台級 watch 模板（可選） | |

---

## 10. 檔案清單（預估）

### PHP — 新模組 `oaaoai/research`

| 路徑 | 動作 |
|------|------|
| `research/default/controller/research.php` | 路由、ACL |
| `research/default/controller/api/watch_*.php` | CRUD |
| `research/default/controller/api/cron_run.php` | 內部 / admin 觸發 |
| `auth/.../_install_*_schema.php` | 四表 DDL |

### Python orchestrator

| 路徑 | 動作 |
|------|------|
| `research/worker.py` | **新增** — fetch / match / notify callback |
| `research/scheduler.py` | **新增** — due watches |
| `fetch/extract.py` | **新增** — 共用正文抽取 |
| `app.py` | 掛 scheduler task |

### SPA

| 路徑 | 動作 |
|------|------|
| `core/.../research-panel.js` | **新增** |
| `core/.../workspace/research` route | shell registry |

---

## 11. 非目標（本 backlog 不做）

- 取代 Chat web_search（即時搜尋仍走 agent）
- 全站爬蟲 / 無限深度 spider
- 多人協作編輯 Watch（v1 僅 owner + tenant admin）
- 自動改寫或摘要後再存 Vault（可另開 `research_summarize` 選項 v2）

---

## 12. 風險與依賴

| 風險 | 緩解 |
|------|------|
| SSRF | URL 解析 + blocklist；僅 tenant admin 可配 auth header |
| 來源 ToS / robots | UI 免責 + rate limit |
| embed  backlog | per-watch `max_new_per_run` |
| 與 filing 中 folder 混淆 | 文件化：research folder 建議 `rag_enabled=1` |

---

## 13. 驗收清單（全案）

- [ ] 可建立 Watch：RSS + Vault folder + cron
- [ ] 定時 / 手動 run 產生新 `oaao_vault_document` 且 embed 完成
- [ ] 關鍵字命中 → `oaao_notification` + UI 可點開
- [ ] 同一 URL 不重複寫入（去重表有效）
- [ ] `Test_Catalog.md` 新增 worker 單元測試（mock RSS + mock vault API）
