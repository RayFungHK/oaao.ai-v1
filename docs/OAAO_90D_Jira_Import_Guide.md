# Jira / Linear CSV 匯入指南

## 檔案

- 匯入檔: [OAAO_90D_Jira_Import.csv](OAAO_90D_Jira_Import.csv)
- 對應 backlog 文件: [OAAO_90D_Jira_Linear_Backlog.md](OAAO_90D_Jira_Linear_Backlog.md)
- W1 Top20 與 owner 框架: [W1_Top20_TechDebt_Owner_Framework.md](W1_Top20_TechDebt_Owner_Framework.md)

## Jira 匯入步驟（標準 CSV import）

1. 進入目標 Jira project（建議 `OAAO-V1`）
2. `Settings` → `System` → `External System Import` → `CSV`
3. 上傳 `OAAO_90D_Jira_Import.csv`，分隔符 `,`，編碼 `UTF-8`
4. 在欄位對應頁面，逐欄對應：
   - `Issue Type` → Issue Type
   - `Issue Key` → 自定欄位 `External Key`（可不映射，由 Jira 重新發 key）
   - `Summary` → Summary
   - `Epic Name` → Epic Name（僅 Epic 有值）
   - `Epic Link` → Epic Link（Story 透過 Epic Key 連結）
   - `Priority` → Priority
   - `Labels` → Labels（多值以 `;` 分隔，匯入時設 multi-value）
   - `Component` → Component/s
   - `Assignee Role` → Custom Field（role 對應內部 owner 表）
   - `Sprint` → Sprint
   - `Description` → Description
   - `Acceptance Criteria` → Custom Field `Acceptance Criteria`
   - `Depends On` → Issue Links: `blocks` / `is blocked by`
5. 預覽確認後 `Begin Import`
6. 匯入後，將 `Assignee Role` 透過自動化規則對應到實際使用者

## Linear 匯入步驟

1. 進入 Workspace `Settings` → `Import / Export` → `CSV`
2. 選擇 target Team（建議 `OAAO`）
3. 上傳同一個 CSV
4. 欄位對應：
   - `Issue Type` → Type（Epic / Story）
   - `Summary` → Title
   - `Description` → Description
   - `Priority` → Priority
   - `Labels` → Labels
   - `Sprint` → Cycle
   - `Epic Link` → Parent Issue
   - `Depends On` → Relations: blocks
5. 匯入完成後使用 Triage 視圖檢查 owner 指派

## 匯入後 24 小時內請完成

1. 將 `Assignee Role` 轉成實際使用者
2. 為每張 Story 建立 6 個 Subtask（Design / Impl / Test / Obs / Doc / Rollback）
3. 設定 Sprint 開始/結束日期，與 13 週節奏對齊
4. 啟用 Sprint Board 並指派 W1 三張卡到 In Progress

## 常見問題

- Labels 顯示為單一字串：匯入時請將 Labels 設為 multi-value，分隔符 `;`
- Epic Link 連不上：先匯入 Epic，再匯入 Story（或一次匯入但 Epic 列在前）
- Sprint 未自動建立：先在 Jira 建好 Sprint W1-W13，再匯入

