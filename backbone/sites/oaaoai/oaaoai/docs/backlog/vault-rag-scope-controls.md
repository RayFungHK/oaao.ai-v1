# Backlog：Folder / File 獨立 RAG 可見性控制

> **狀態**：延後實作（2026-05-19 記錄）  
> **動機**：Filing 或整理期間，暫時不要讓 Chat RAG 搜到特定 folder / file；完成後再開放。  
> **相關討論**：Chat composer「Auto Source」、vault embed 生命週期、`embed_status`。

---

## 現況（已具備，無需重做）

| 層級 | 機制 | 行為 |
|------|------|------|
| **Vault** | `oaao_vault.is_enabled`（UI：Auto index） | `0` → 上傳存檔、`embed_status=held`、不自動排 ingest；`1` → `pending` + 自動 queue |
| **File** | `oaao_vault_document.embed_status` | 僅 `embedded` 進 Chat picker、citation catalog、folder 子樹 scope 查詢 |
| **Ingest** | `held` → `pending` → `embedding` → `embedded` / `failed` | Qdrant 向量在 embed job **完成**後才寫入（`vault_job_finish`） |

**結論**：Filing / ingest **進行中**的檔案（非 `embedded`）**已不會**被 Chat RAG 命中。  
**缺口**：Folder 級開關、embedded 後仍可「軟關 RAG」、整包 folder filing 閘門、與 embed 脫鉤的 per-file toggle。

---

## 目標（後續要做）

1. **Folder**：可設「此資料夾（含子樹）暫不參與 Chat RAG」，filing 完成後一鍵開放。
2. **File**：`embedded` 後仍可獨立關閉 RAG（不刪檔、可選是否保留向量）。
3. **一致過濾**：Vault tree UI、Chat composer picker、Auto Source、`send.php` → orchestrator Qdrant/Graph 查詢，**同一套規則**。
4. **可選 workflow**：明確「filing 完成」狀態（人工或自動），與 embed 完成解耦。

---

## 建議資料模型

### 方案 A（最小增量，推薦先做）

| 表 | 欄位 | 預設 | 說明 |
|----|------|------|------|
| `oaao_vault_container` | `rag_enabled SMALLINT NOT NULL DEFAULT 1` | `1` | Folder 關閉時，子樹內所有文件對 RAG **不可見**（繼承：子 folder 可覆寫） |
| `oaao_vault_document` | `rag_searchable SMALLINT NOT NULL DEFAULT 1` | `1` | 與 `embed_status` 正交；`embedded` 且 `rag_searchable=0` → 不檢索 |

**有效可搜條件（Chat RAG）**：

```text
embed_status = 'embedded'
AND rag_searchable = 1
AND 所在 container 祖先鏈上 rag_enabled = 1（vault 根視為 1）
```

**不新增** `filing_status` 第一版：filing 中仍用 `held` / 關 Auto index；folder 關 `rag_enabled=0` 涵蓋「整包暫停」。

### 方案 B（完整 workflow，第二階段）

| 表 | 欄位 | 說明 |
|----|------|------|
| `oaao_vault_container` | `filing_status TEXT` | 例：`open` / `in_progress` / `ready`；`ready` 前強制 `rag_enabled=0` |
| `oaao_vault_document` | `filing_status TEXT` | 單檔覆寫（可選） |

---

## 向量策略（實作前需定案）

| 策略 | 優點 | 缺點 |
|------|------|------|
| **軟關**（保留 Qdrant points，查詢時 filter `rag_searchable` + folder） | 可逆、快 | 向量仍佔空間；filter 必須三端一致 |
| **硬關**（關 RAG 時刪 Qdrant/Arango 該 doc points） | 儲存乾淨 | 重開 RAG 需 re-embed；較慢 |

**建議**：第一版 **軟關**；硬刪留作 Settings 進階或「永久下架」。

---

## 需修改的程式面（ checklist ）

### Schema / migration

- [ ] `_install_pg_core_schema.php` + `_install_sqlite_schema.php` + `oaao_auth_ensure_pg_vault_workspace_and_jobs()` ALTER
- [ ] 既有列 backfill：`rag_enabled=1`, `rag_searchable=1`

### PHP — Vault

- [ ] `vault_tree` payload：container / document 節點帶 `rag_enabled` / `rag_searchable`
- [ ] `document_status`：同上（poll UI badge）
- [ ] 新 API 或擴充現有：
  - `POST container_rag_set` — `{ container_id, rag_enabled }`
  - `POST document_rag_set` — `{ document_id, rag_searchable }`
- [ ] `document_upload`：繼承所在 folder 的 `rag_enabled`（可選：upload 到關閉 folder 時直接 `rag_searchable=0`）
- [ ] `ChatVaultScope::filterVaultIdsWithEmbeddedDocuments` → 改為「可 RAG 的 embedded 文件」計數
- [ ] `ChatVaultScope::scopedDocumentIdsByVault` → 加 folder 祖先 + `rag_searchable` 條件
- [ ] `documentCitationCatalog` → 同上

### PHP — Chat

- [ ] `send.php`：scope 文件列表已過濾；必要時 payload 加 `vault_rag_policy` 供 sidecar 雙重檢查

### Python — Orchestrator

- [ ] `vault_graph_rag.py`：Qdrant search 加 payload filter（若 point payload 含 `rag_searchable`）或僅依 PHP 傳入的 `vault_scope_documents`（第二種較簡，但 Auto Source 全 vault 搜時 PHP 須傳 allow-list）
- [ ] `vault_arango.py` graph 查詢：folder/doc 關閉時排除（GraphRAG 第二階段）

### Frontend

- [ ] `vault-panel.js`：folder / file context menu 或 detail panel — RAG toggle + badge（`RAG off` / `Filing`）
- [ ] `chat-panel.js`：`flattenVaultTreeForChatSources` 排除 `rag_searchable=0` 與關閉 folder 下文件
- [ ] `rag-citations.js`：標籤仍可顯示（citation 來自實際 hit）；無需改 unless 關 RAG 後仍 cite 舊 run

### i18n

- [ ] `vault/default/lang/*.php` + vault-panel `CHAT_VAULT_*` / sidebar strings

---

## UI / UX 草案

- **Folder 列**：badge `RAG paused`（`rag_enabled=0`）；右鍵或 sidebar「Resume RAG for this folder」
- **File 列**：`embedded` + `rag_searchable=0` → badge `Hidden from chat`；toggle 不觸發 re-embed
- **Filing 工作流（方案 B）**：folder 設 `in_progress` 時自動 `rag_enabled=0`；完成設 `ready` 並提示「Open RAG?」

---

## 與現有 `is_enabled` / `embed_status` 的關係

| 控制 | 管什麼 | 不要混淆 |
|------|--------|----------|
| `is_enabled` | 上傳是否**自動排 ingest** | ≠ Chat 是否可搜 |
| `embed_status` | 向量是否**已建立** | ≠ 使用者是否允許搜 |
| `rag_enabled` / `rag_searchable`（新） | Chat RAG **是否可見** | 可 `embedded` 但關搜尋 |

---

## 測試計畫（實作時）

1. Folder 關 RAG → 子樹 embedded 檔不出現在 picker、Auto Source 不命中、manual vault 整包搜也不命中該 doc ids。
2. File 關 `rag_searchable` → 同上，僅該檔。
3. 重新開啟 → 無 re-embed（軟關）下立即恢復檢索。
4. Workspace scope 403 / membership 回歸（`ChatVaultScope` join）。
5. ETag / `vault_tree` lite 欄位變更後 cache invalidate。

---

## 開放問題（實作前決策）

1. Folder 關閉時，**新上傳**是否自動 `rag_searchable=0`？（建議：是，繼承 folder）
2. Auto Source 全 vault 搜尋：PHP 是否每次送 **allow-list document ids**，或 Qdrant payload 加 flag 由 sidecar filter？（建議：PHP 算 allow-list，與現有 `vault_scope_documents` 一致）
3. 是否需要 audit log（`logging` API）記錄 RAG toggle？
4. 方案 B `filing_status` 是否為產品必需，或可先用 folder toggle 代替？

---

## 參考檔案

- `vault/default/controller/vault.php` — `oaao_vault_auto_rag_ingest_enabled`, tree builder
- `vault/default/controller/api/document_upload.php` — `held` / `pending` 初始狀態
- `chat/default/library/ChatVaultScope.php` — Auto Source / scope 文件解析
- `chat/default/webassets/js/chat-panel.js` — picker 僅 `embedded`
- `python/oaao_orchestrator/vault_graph_rag.py` — Qdrant search + scope docs
