# OAAO.ai 產品路線 — 2026 年 5 月下旬

**2026-05-27 起**累積的變更與接下來的方向。這是工作區第一則 **What's New** 文章。

## 已進入程式庫的功能

### 對話與編排

- **網路搜尋** — 依 purpose 的 LLM 路由、SearXNG、Composer **強制網搜** 開關，以及依使用者顯示語言過濾結果。
- **Composer** — 多行輸入、**管線／Planner 步驟** 開關、Planner 模式選單（Default／ToT／DDTree）、送出時顯示 **點數**。
- **上下文視窗** — **context usage** API 與 Composer 圓環（分段用量、接近上限時可 **CIT/CMT 壓縮** 舊訊息）。
- **語音** — Composer 即時與批次 ASR，結束時 LLM 潤飾。

### Vault、Library 與內容

- **Vault 第二階段** — 匯入 SSE 進度、HTML 拆分、圖譜逐字稿修正、卡片版面與 job 背壓修復。
- **Library 工作區** — 獨立 **Library** rail、區塊編輯器殼層、Chat **@library** 附加（軟 RAG，與 Vault 自動來源分開）。
- **Corpus／簡報** — 網頁轉投影片管線修正；slide-designer 與 Razy 模組 autoload 對齊。

### 平台與設定

- **租戶儲存** — 本機／S3／GCS／HF 後端與遷移 UI。
- **Endpoints** — 端點與 purpose 設定的 CLI **匯出／匯入**。
- **管理** — 使用者用量總覽、通知下拉樣式。
- **維運** — Redis canary、orchestrator 健康檢查、Windows PowerShell 監控腳本。
- **版本說明（PLAT-1）** — Platform CMS 與工作區 **What's New**（本文章）。

### 文件與 Epic

- **Content Studio** 更新：**Calendar agent**（rail）、**Todo agent**（標題列）、**ERP 業務工作區** 長期設計。

## 進行中（工作區尚未全部合併）

- **Inference v2** — Composer **關閉／自動／手動**；system + 使用者偏好 baseline；每輪 planner **`inference_delta`**；可選 ACCS 回饋（環境變數）。見 `docs/design/chat-inference-auto-tune.md`。
- **個人化精靈** — 隨機主題 → 三種 LLM 風格 → 細調並儲存預設參數（依偏好語言顯示文案）。
- **Todo 模組** — 標題待辦面板、對話內 chip、orchestrator 候選串流。
- **Library 編輯器** — 區塊互動、轉檔上傳 API、orchestrator convert 路由。
- **Composer 修正** — 上下文圓環改掛在功能按鈕列（不再佔用下方 extra toolbar 空隙）。

## 路線圖（下一步）

| 主題 | 方向 |
| ---- | ---- |
| **Content Studio** | Corpus  schema 化抽取（CS-1）、Library 硬 RAG + 存入 Vault、Office Agent 產物 |
| **Agent** | Calendar／Todo 從對話 chip 到工作區紀錄的 E2E |
| **Platform** | 發布版本說明後跨租戶通知 + 已讀狀態 |
| **Inference** | 以 baseline + planner 微調為主；Settings 內 purpose 預設 |
| **企業** | ERP 業務工作區模組（`docs/design/erp-business-workspace.md`） |

## 建議操作

1. 部署後請 **強制重新整理** 工作區（chat／core 資源帶版本參數）。
2. 到 **設定 → Endpoints** 與 **偏好設定** 調整語言、inference、個人化。
3. 開啟對話後，再依需要開啟 **網搜** 或 **管線步驟**。

回報問題時請附上頁尾或 `GET /api/build_info` 的 **build_id**。
