# Pipeline：Index / List vs Static（Research & Data Mining 共用）

> **狀態**：2026-05-22 — Index/static 管線 + **source_discover**（P0–P3 router，確認後立檔）  
> **相關**：[scheduled-article-research.md](./backlog/scheduled-article-research.md) · [scheduled-data-mining.md](./backlog/scheduled-data-mining.md)

---

## 1. 兩種來源模式

| 模式 | 英文代號 | 典型 URL | 每次 run | 增量方式 |
|------|----------|----------|----------|----------|
| **Index / List** | `index` | [arXiv cs.AI recent](https://arxiv.org/list/cs.AI/recent)、RSS、sitemap | 抓 **列表頁** → 抽出 **item links** → 只處理 **新 link** | `known_urls` / link 集合 |
| **Static / Live page** | `static` | 單篇文章、固定 API、同一 HTML 表格頁 | 反覆 fetch **同一 URL** | `content_hash` 或列級 `natural_key` upsert |

```text
                    ┌─────────────────┐
  Source URL ──────►│ Discover 判定   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
       index / list                   static
    列出 item links                 整頁 payload
              │                             │
              ▼                             ▼
     Research: 逐 link fetch          Research: 抽正文 + hash
     正文 → summary → Vault           新 hash → Vault
              │                             │
              ▼                             ▼
     Mine: LLM + columns 抽列         Mine: LLM + columns 抽列
     natural_key upsert               natural_key upsert
```

---

## 2. Article Research

### 2.1 Index pipeline（例：arXiv recent）

1. **Source**：`index:https://arxiv.org/list/cs.AI/recent`
2. **Discover**：HTML 抽出 `arxiv.org/abs/2605.xxxxx`
3. **Filter**：減 `oaao_research_item` 已知 URL
4. **Fetch**：每個 abs → markdown 正文
5. **Summarize**：LLM 依 `summary_language`
6. **Write**：`{slug}.md` + `{slug}_summary.md` → Research Vault folder → embed

### 2.2 Static pipeline

1. **Source**：`https://example.com/long-form-article` 或 `static:…`
2. **Fetch**：同一 URL
3. **Dedupe**：`content_hash` / canonical URL（已存在則 skip）
4. 其餘同 Index 的 fetch → summary → Vault

### 2.3 Source 行格式（Watch dialog）

```text
# Index — 列表頁，每輪發現新 link（arXiv list、RSS 等）
index:https://arxiv.org/list/cs.AI/recent
https://example.com/feed.xml

# Static — 同一 URL，比對是否已抓過
static:https://example.com/weekly-digest
https://arxiv.org/abs/2605.23904
```

| 前綴 / 自動判定 | `kind` | 行為 |
|-----------------|--------|------|
| `index:` 或 URL 含 `arxiv.org/list/` | `index` | Link discovery → 多 item |
| RSS / `.xml` feed | `rss` | feedparser → 多 item |
| `arxiv.org/abs/` 或 bare id | `arxiv` | 單篇 |
| `static:` 或其他 URL | `static` / `url` | 單 URL 每輪 |

---

## 3. Data Mining

### 3.1 為何需要 columns / schema

Mine 輸出是 **SQLite 列**，LLM 必須知道欄位形狀：

```json
{
  "table_name": "arxiv_cs_ai_recent",
  "columns": [
    { "name": "arxiv_id", "sql_type": "TEXT" },
    { "name": "title", "sql_type": "TEXT" },
    { "name": "authors", "sql_type": "TEXT" },
    { "name": "submitted_date", "sql_type": "TEXT" }
  ],
  "natural_key": ["arxiv_id"]
}
```

### 3.2 Index vs Static（Mine）

| 模式 | Source 範例 | Fetch | LLM |
|------|-------------|-------|-----|
| **Index** | `index:https://arxiv.org/list/cs.AI/recent` | HTML 列表頁 | 依 **schema columns** 抽多列；`natural_key` upsert |
| **Static** | `html:https://example.com/prices` 或 JSON API | 同一 URL | 依 columns 抽列；列級 delta |

```text
# Mine sources（dialog）
index:https://arxiv.org/list/cs.AI/recent
html:https://example.com/data-table | .price-table
csv:https://example.com/prices.csv
https://api.example.com/v1/items | data.items
```

**Index 來源必須提供 `schema_json`（或首次 run 允許 LLM 建議後 freeze）。**

### 3.3 Discover → Confirm（新建 Mine / Watch）

新建時須先 **Analyze**，預覽後按 **Confirm & create** 才寫入 DB / Vault：

| 步驟 | Research | Mine |
|------|----------|------|
| API | `POST /research/api/source_discover` | `POST /mine/api/source_discover` |
| Orchestrator | `/v1/research/discover` | `/v1/mine/discover` |
| 輸出 | 頁型 + 標題/連結列表 | dataset_mode + suggested_schema + sample_rows |
| 立檔 | `discover_confirmed: true` on `watch_save` | 同上 on `mine_save` |

Router：**L0 規則 → L1 特徵分數 → L2 LLM（模糊時）→ link filter**；P3 可傳 `use_playwright: true`。

---

## 4. 實作狀態（2026-05-22）

| 能力 | Research | Data Mining |
|------|----------|-------------|
| RSS → links | ✅ | — |
| arXiv list → abs links | ✅ `kind=index` | ✅ `http_index` + arXiv heuristic；generic index → schema LLM |
| Static URL dedupe | ✅ `known_urls` | ✅ natural_key upsert |
| UI pipeline 說明 | ✅ dialog hints | ✅ dialog hints |
| LLM 自動判定 index/static | ✅ discover + confirm UI | ✅ discover + confirm UI |

---

## 5. 下一步

1. **Research**：index 頁 `last_index_hash` 增量 skip（P2 runtime）
2. **共用**：cron 排程 + 自適應掃描頻率
3. **UI**：discover 對話框 Playwright 切換、關鍵詞過濾欄位
