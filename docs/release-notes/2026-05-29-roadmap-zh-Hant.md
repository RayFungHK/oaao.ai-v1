# 產品更新 — 2026 年 5 月下旬

**2026-05-27 起至今日的變更摘要。** 這是工作區通知鈴與 **What's New** 的第一則 **news** 文章。

## 對話與編排

- **網路搜尋** — 依 purpose 的 LLM 路由、SearXNG、Composer **強制網搜**，以及依使用者顯示語言過濾結果。
- **Composer** — 多行輸入、**管線／Planner 步驟**、Planner 模式（Default／ToT／DDTree）、送出 **點數**、**上下文用量** 圓環與接近上限時的 **CIT/CMT 壓縮**。
- **截斷續寫** — 助理訊息達輸出上限時可 **Continue**，內容接續在同一則氣泡。
- **語音** — Composer 即時與批次 ASR，結束時 LLM 潤飾。
- **Inference v2** — Composer **關閉／自動／手動**；system + 使用者偏好 baseline；每輪 planner **`inference_delta`**（見 `docs/design/chat-inference-auto-tune.md`）。
- **訊息評價（UX-1）** — 助理訊息 **讚／倒讚**；**倒讚** 會以有界方式微調已儲存的 **model params**（temperature／penalty），並寫入偏好設定稽核紀錄。

## Vault、Library 與內容

- **Vault 第二階段** — 匯入 SSE 進度、HTML 拆分、圖譜逐字稿修正、卡片版面、job 背壓修復。
- **Library 工作區** — 獨立 **Library** rail、區塊編輯器、Chat **@library** 附加（僅附加時 soft-RAG；與 Vault 自動來源分開）。
- **Corpus** — Schema 化 analyze（`document_type` registry）、Markdown／HTML 模板雙軌、HTML/PDF 預覽 render job。
- **簡報** — 網頁轉投影片管線修正；slide-designer 與 Razy 模組 autoload 對齊。

## 平台與設定

- **租戶儲存** — 本機／S3／GCS／HF 與遷移 UI。
- **Endpoints** — 端點與 purpose **匯出／匯入**（建議 **26B** 負責全上下文對話、**E4B** 負責 planner — 見設定 → Purposes）。
- **版本說明（PLAT-1）** — Platform CMS、工作區 **What's New**、build 列 deep link、發布後 **跨租戶通知** 分批 fan-out（本文章）。
- **個人化** — 引導問卷、性格 preset、Advanced 參數面板、Settings **Re-tune**。
- **管理與維運** — 使用者用量總覽、通知下拉樣式、Redis canary、orchestrator 健康檢查。

## 產品方向（文件）

- **Content Studio** Epic：**Calendar agent**（rail）、**Todo agent**（標題列）、**ERP 業務工作區** 長期設計（`docs/design/erp-business-workspace.md`）。

## 建議操作

1. 部署後 **強制重新整理** 工作區（chat／core 資源帶版本參數）。
2. 到 **設定 → Endpoints** 與 **偏好設定** 調整語言、inference、個人化。
3. 開啟對話後，依需要開啟 **網搜** 或 **管線步驟**；若回覆太冗長可試一次 **倒讚** 微調參數。
4. 點 **通知鈴** — 開啟本則 **news** 進入 **What's New** 全文。

回報問題請附上頁尾或 `GET /api/build_info` 的 **build_id**。
