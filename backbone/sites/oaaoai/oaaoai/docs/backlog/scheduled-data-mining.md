# Backlog：排程 Data Mining — 定時抓數據 → LLM 結構化 → SQLite → DataTable

> **狀態**：Backlog（2026-05-22）— **延後實作**  
> **目標**：使用者定義一或多 **資料來源**（API / CSV URL / HTML 表格 / JSON endpoint），依 **cron** 定時 fetch → **LLM 分析結構與有效列** → 寫入 **一 Mine 一 SQLite 檔** → SPA **DataTable** 檢視新資料 → 可選 **notification**。  
> **硬性規則**：fetch + LLM + SQLite 寫入在 **Python orchestrator**；PHP 負責 Mine CRUD、ACL、檔案路徑、列表 API、通知；**不**把 mined rows 預設寫入 Qdrant（與 Vault RAG 分離）。

**相關**：[scheduled-article-research.md](./scheduled-article-research.md)（共用 fetch 層）· [Pipeline_Index_vs_Static.md](../Pipeline_Index_vs_Static.md) · [credit-top-up-and-consumption.md](./credit-top-up-and-consumption.md)

---

## 2.1 Pipeline 模式（Index vs Static）

> 完整說明見 **[Pipeline_Index_vs_Static.md](../Pipeline_Index_vs_Static.md)**。

| 模式 | 用途 | Mine 要求 |
|------|------|-----------|
| **Index / List** | 列表頁 → 多列 / 多 link；每輪 **新列 upsert** | **必須**有 `schema_json.columns` + `natural_key` |
| **Static** | 同一 URL/API；列級 **natural_key** delta | schema 或 LLM hints |

Data Mining 管線：**Fetch payload → LLM 依 columns 抽列 → SQLite upsert → DataTable**。Index 來源（例 arXiv list）需 `schema_json`；`http_index` 會先嘗試 arXiv heuristic，否則以固定 schema 呼叫 LLM 抽列。

---

## 1. 背景與動機

| 現況 | 缺口 |
|------|------|
| Vault + embed | 適合 **文件 / 段落 RAG**，不適合 **結構化表格** 增量查詢 |
| Chat agent + web_search | 無持久化 tabular store |
| RazyUI **DataTable** | 已有元件，無 Mine 專用頁 |
| Article Research（backlog） | 正文進 Vault；Mining 進 **SQLite** |

**使用情境**：股價/匯率 API、政府統計 CSV、競品價格列表 HTML；定時拉取 → LLM 對應欄位 → 使用者打開 DataTable 看「自上次以來新增列」。

---

## 2. 產品決策（實作前凍結）

| # | 決策 |
|---|------|
| 1 | 新模組 **`oaaoai/mine`**；SPA：`workspace/mines`、詳情 `workspace/mines/{mine_id}` |
| 2 | **一 Mine = 一 SQLite 檔** `{OAAO_MINE_DATA_ROOT}/{tenant_id}/{mine_id}.sqlite` |
| 3 | Schema 策略 v1：**LLM 建議表名 + 欄位** + 固定系統欄 `_mine_row_id`, `_fetched_at`, `_run_id`, `_source_key` |
| 4 | 增量策略：LLM 或規則產出 **natural key**（例 `symbol+date`）→ `UNIQUE` upsert；UI 標「新列」= 本次 run `INSERT` 成功 |
| 5 | LLM purpose：**`chat.primary`** 或專用 **`mine.primary`**（結構化 JSON output） |
| 6 | 通知：`kind = mine_new_rows`，body 含 `{mine_id, run_id, new_count}` |
| 7 | 安全：SSRF 同 Research；SQLite 僅 orchestrator + PHP read API 接觸，**不**暴露檔案直鏈 |
| 8 | 可選 v2：高價值列 **export → Vault document**（單獨 backlog 鉤子） |

---

## 3. 架構（目標）

```text
┌──────────────────┐                      ┌─────────────────────────┐
│ SPA workspace/   │                      │ PostgreSQL               │
│ mines            │ ── mine 定義 ───────► │ oaao_mine                │
│ + DataTable      │                      │ oaao_mine_source         │
└────────┬─────────┘                      │ oaao_mine_run            │
         │ GET /mine/api/rows             └────────────┬────────────┘
         │                                              │
         ▼                                              ▼
┌──────────────────┐     fetch + LLM + SQL    ┌─────────────────────────┐
│ PHP read API     │ ◄────────────────────── │ orchestrator             │
│ (paginate, filter)│                         │ mine_worker.py           │
└──────────────────┘                          │  → *.sqlite (bind mount) │
                                              └─────────────────────────┘
```

**儲存根目錄**：`OAAO_MINE_DATA_ROOT`（docker bind，web + orchestrator 共用只讀/讀寫分工：worker 寫、PHP 讀）。

---

## 4. 資料模型（草案）

### 4.1 `oaao_mine`

| 欄位 | 說明 |
|------|------|
| `mine_id` | PK |
| `tenant_id`, `owner_user_id` | ACL |
| `label`, `description` | |
| `cron_expr` / `interval_minutes` | |
| `is_enabled` | |
| `schema_json` | 上次 LLM 凍結的 schema（表名、columns、natural_key） |
| `llm_hints_json` | 給 LLM 的領域說明、範例列 |
| `notify_json` | `{ "in_app": true, "min_new_rows": 1 }` |
| `sqlite_path` | 相對 `OAAO_MINE_DATA_ROOT` |
| `last_run_at`, `next_run_at` | |

### 4.2 `oaao_mine_source`

| 欄位 | 說明 |
|------|------|
| `source_id`, `mine_id` | |
| `kind` | `http_json` \| `http_csv` \| `http_html_table` \| `http_index` \| `static_url` |
| `config_json` | URL、method、headers、jq_path（JSON）、table selector；`source_mode`: `index` \| `static` |
| `fetch_mode` | `http` \| `playwright` |

### 4.3 `oaao_mine_run`

| 欄位 | 說明 |
|------|------|
| `run_id`, `mine_id` | |
| `status` | `queued` → `running` → `done` \| `failed` |
| `stats_json` | `{ "rows_parsed": 100, "rows_inserted": 12, "rows_updated": 3, "schema_changed": false }` |
| `error_text` | |

---

## 5. LLM 結構化流程

```text
raw payload (JSON/CSV/HTML snippet, 截斷至 token 預算)
    → LLM structured output:
        {
          "table_name": "prices",
          "columns": [
            { "name": "symbol", "sql_type": "TEXT" },
            { "name": "price", "sql_type": "REAL" },
            { "name": "as_of", "sql_type": "TEXT" }
          ],
          "natural_key": ["symbol", "as_of"],
          "rows": [ { "symbol": "0700.HK", "price": 380.2, "as_of": "2026-05-22" }, ... ]
        }
    → DDL migrate（若 schema_json 變更需 admin 確認或 auto-add-column 政策）
    → INSERT OR REPLACE / INSERT OR IGNORE
```

| 政策 | 建議 |
|------|------|
| Schema 變更 | v1：**阻擋 run** 並通知 admin 手動「Approve schema」 |
| 列過濾 | LLM 標 `is_valid`；僅 valid 列寫入 |
| Token 超限 | 分 chunk 多次 LLM + merge by natural_key |

Purpose：新增 slot **`mine.*`**（`mine.primary`）或在 `meta_json` 指定 `response_format: json_schema`。

---

## 6. SQLite 慣例

每張業務表必含：

```sql
_mine_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
_fetched_at TEXT NOT NULL,
_run_id INTEGER NOT NULL,
_source_key TEXT
```

- PHP **`GET /mine/api/rows?mine_id=&table=&since_run_id=&page=`** — 分頁、排序、filter。  
- **「新資料」**：`WHERE _run_id = ?` 或 ` _fetched_at > :last_visit`。  
- 備份：SQLite 檔案隨 `OAAO_MINE_DATA_ROOT` 備份；可選 export CSV API。

---

## 7. UI（SPA + DataTable）

| 頁面 | 功能 |
|------|------|
| `workspace/mines` | Mine 列表、enabled、cron、上次 new_rows |
| Mine 編輯 | 來源、LLM hints、schema 預覽、cron |
| Mine 詳情 | RazyUI **DataTable**：欄位、排序、搜尋、分頁；badge「本次 run +N 列」 |
| Run 歷史 | status、stats、error；重新 run |

參考既有 DataTable：`core/.../razyui/` 元件；風格對齊 Vault / Settings 表格式。

---

## 8. 排程

與 [scheduled-article-research.md](./scheduled-article-research.md) 相同：

- orchestrator **`mine_scheduler.py`** 掃 `next_run_at`
- **`POST /mine/api/run_now`** 手動觸發
- 可選 platform systemd 呼叫 `cron_run`

---

## 9. 實作分期

### Phase A — 單來源 JSON + 固定 schema + SQLite + DataTable

| 任務 | 說明 |
|------|------|
| Schema + PHP CRUD | |
| `mine_worker`：HTTP GET JSON → 手寫 jq 路徑（無 LLM） | |
| SQLite 寫入 + PHP rows API | |
| SPA DataTable 唯讀 | |

**驗收**：手動 run 後 UI 看到列；refresh 可見新 run 增量。

### Phase B — LLM 結構化 + cron + 通知

| 任務 | 說明 |
|------|------|
| LLM schema + rows extract | |
| Scheduler + upsert by natural_key | |
| `mine_new_rows` notification | |
| Mine 列表 / 編輯 UI | |

**驗收**：CSV/HTML 範例 → LLM 建表並寫入；定時 run；新列通知。

### Phase C — 多來源 merge + Playwright + export

| 任務 | 說明 |
|------|------|
| 多 source 合併至同一表 | |
| Playwright 抓表 | |
| Export CSV / optional Vault 匯出 | |
| usage / credit | |

---

## 10. 檔案清單（預估）

### PHP — `oaaoai/mine`

| 路徑 | 動作 |
|------|------|
| `mine/default/controller/mine.php` | |
| `mine/default/controller/api/mine_*.php` | CRUD, `rows`, `run_now`, `cron_run` |
| `auth/.../_install_*_schema.php` | |

### Python

| 路徑 | 動作 |
|------|------|
| `mine/worker.py` | fetch, LLM, sqlite |
| `mine/schema_migrate.py` | DDL 安全變更 |
| `mine/scheduler.py` | |
| `fetch/extract.py` | 與 research 共用 |

### SPA

| 路徑 | 動作 |
|------|------|
| `core/.../mine-panel.js` | 列表 + 詳情 DataTable |
| `core/.../mine-edit-form.js` | |

### Docker

| 路徑 | 動作 |
|------|------|
| `docker/env.example` | `OAAO_MINE_DATA_ROOT` |
| `docker-compose.yml` | web + orchestrator volume mount |

---

## 11. 非目標（本 backlog 不做）

- 取代 Postgres 作為主業務 OLTP
- 即席 SQL 給一般使用者（僅 DataTable filter；admin SQL console v2 可另議）
- 即時 streaming 報價（Mining 是 **batch cron**）
- 自動 sync 到 Qdrant（除非 v2 Vault export 明確開啟）

---

## 12. 風險與依賴

| 風險 | 緩解 |
|------|------|
| LLM 幻覺欄位 | schema approve；sample preview run |
| SQLite 鎖 | 單 writer（orchestrator）；PHP 唯讀 connection |
| 大表 UI 效能 | 分頁必做；預設 limit 100 |
| 惡意 URL | 同 Research SSRF 策略 |

---

## 13. 驗收清單（全案）

- [ ] 建立 Mine + JSON URL + cron
- [ ] LLM（或 Phase A 固定 mapping）寫入 SQLite
- [ ] DataTable 分頁瀏覽；標示新列
- [ ] `new_count >= min_new_rows` → notification
- [ ] 單元測試：mock LLM JSON + temp sqlite + upsert 邏輯
