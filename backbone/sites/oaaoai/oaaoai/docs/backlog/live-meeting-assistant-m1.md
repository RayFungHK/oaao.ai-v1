# Live Meeting Assistant — M1 規劃與檔案清單

> **狀態**：M1 規劃凍結（2026-05-21）— 待實作  
> **產品目標**：新 SPA 頁即時會議參謀 — Qwen3-ASR Live 字幕、Bubble 關鍵字/問題、點擊查資料、Materials Dialog、音訊可落盤與 TTL。  
> **硬性規則**：長連線（WS 上行音訊、SSE 下行事件）只在 **Python orchestrator**；PHP 只做 session JSON、權限、落盤路徑。

---

## 1. 已確認決策

| # | 決策 |
|---|------|
| 1 | **ASR**：Qwen3-ASR Live/Streaming（Purpose `asr.*`） |
| 2 | **延遲**：partial 300–800ms 可接受 |
| 3 | **LLM 節流**：debate 5–10s / 1v1 15–30s / meeting 60s+（見 §4） |
| 4 | **音訊**：落盤 `data/live-meeting/`；可「保留」；未保留則 TTL 刪除；結束可選 summarize |
| 5 | **UX**：獨立頁；Bubble 跳出；資料增量計數；可修正上下文；點 Bubble → Dialog 看材料 |

---

## 2. M1 範圍（驗收）

| 包含 | 不包含（M2+） |
|------|----------------|
| 新頁 `workspace/live-meeting` 殼 + 錄音 UI | Bubble + RAG + Materials Dialog |
| PHP `session_start` / `session_stop` | Cadence debate/meeting 自動節流 |
| Orchestrator WS 收 PCM + Qwen3 streaming 橋接 | 會後長摘要、推送 Chat |
| SSE `live_transcript`（partial/final） | Redis 多實例 |
| 音訊 segment 落盤 + 基本 TTL 設定 | TTS 回覆（延後 → [multimodal-tts-provider-api.md](./multimodal-tts-provider-api.md) §2 Supertonic 3） |

**M1 驗收**：開麥 → 10s 內看到滾動逐字稿；Network 有 WS 上行與 SSE 下行；停止後音訊依設定保留或刪除。

---

## 3. 架構（M1）

```text
Browser (live-meeting-panel.js)
  AudioWorklet 16kHz PCM ──WS──► orchestrator /v1/live/{id}/audio
  EventSource ◄──SSE── orchestrator /v1/live/{id}/stream

PHP live-meeting/api/session_start
  → session_id, ws_url, stream_url, stream_token

data/live-meeting/sessions/{id}/
  meta.json, audio/seg_*.pcm, transcript.jsonl
```

---

## 4. Cadence（M2 預留，M1 只寫入 meta 預設 `1v1`）

| Profile | 自動 LLM 間隔 | 場景 |
|---------|----------------|------|
| `debate` | 5–10s | 辯論、快問快答 |
| `1v1` | 15–30s | 單對單客戶 |
| `meeting` | 60s+ | 多人會議 |

手動點 Bubble 永遠立即執行（M2）。

---

## 5. SSE 事件（全產品；M1 僅實作 transcript）

| kind | M1 | 說明 |
|------|-----|------|
| `live_transcript` | ✅ | `{ text, is_final, t_ms }` |
| `live_bubble` | M2 | keyword / question |
| `live_stats` | M2 | evidence_total, delta |
| `live_materials` | M2 | Dialog 引用 |
| `live_insight_delta` | M2 | 助手 Markdown 流 |
| `live_phase` | M2 | idle / rag / thinking |

沿用 orchestrator `StreamEnvelope` 包裝（與 chat 同族）。

---

## 6. Purpose allocation（Settings）

| Slot | M1 | 用途 |
|------|-----|------|
| `asr.*` | ✅ 必須 | Qwen3 Streaming（`meta_json.mode=streaming`） |
| `asr.live.*` | **Backlog** — 接 **https://funasr-nano.rayfung.hk** + Purpose slot；見 [local-asr-live-funasr-mlt-nano.md](./local-asr-live-funasr-mlt-nano.md) |
| `live_meeting.*` | M2 | Bubble / 組題 |
| `chat.*` + `embedding.*` | M2 | RAG 回答 |
| `asr_summary.*` | M3 | 會後摘要 |

---

## 7. M1 檔案清單

### 7.1 文件

| 路徑 | 動作 |
|------|------|
| `backbone/sites/oaaoai/oaaoai/docs/backlog/live-meeting-assistant-m1.md` | 本檔 |
| `docker/env.example` | 新增 `OAAO_LIVE_MEETING_*` 註解 |
| `docker-compose.yml` | web + orchestrator 掛載 `data/live-meeting` |

### 7.2 PHP 模組 `oaaoai/live-meeting`

| 路徑 | 動作 |
|------|------|
| `live-meeting/default/module.php` | 模組註冊 |
| `live-meeting/default/package.php` | 依賴 auth、endpoints |
| `live-meeting/default/controller/live-meeting.php` | 懶路由 + SPA shell |
| `live-meeting/default/controller/api/session_start.php` | POST → orchestrator 建立 session |
| `live-meeting/default/controller/api/session_stop.php` | POST 停止 |
| `live-meeting/default/library/_bootstrap.php` | 共用 require |
| `live-meeting/default/library/LiveMeetingStorage.php` | `data/live-meeting` 根路徑、segment 目錄 |
| `live-meeting/default/library/LiveMeetingOrchestrator.php` | internal JSON 呼叫 |
| `live-meeting/default/view/shell.tpl` | 或僅 webassets 由 core mount |
| `live-meeting/default/webassets/js/live-meeting-panel.js` | 麥克風 + SSE 字幕 |
| `live-meeting/default/webassets/js/live-meeting-audio.js` | AudioWorklet / PCM WS |
| `live-meeting/default/webassets/css/live-meeting.css` | 版面 |

### 7.3 Core 掛頁

| 路徑 | 動作 |
|------|------|
| `core/default/controller/core.php` | `SpaRegister::add('workspace/live-meeting', …)` |
| `core/default/webassets/js/workspace.js` | 確認 mount 路徑（若需） |

### 7.4 Python orchestrator

| 路徑 | 動作 |
|------|------|
| `python/oaao_orchestrator/app.py` | 路由 `POST /v1/live/session_start`、`GET /v1/live/stream`、WS audio |
| `python/oaao_orchestrator/live_meeting/__init__.py` | 套件 |
| `python/oaao_orchestrator/live_meeting/session.py` | `LiveSession` 狀態、TTL |
| `python/oaao_orchestrator/live_meeting/audio_store.py` | segment 落盤 |
| `python/oaao_orchestrator/live_meeting/qwen_asr_stream.py` | Qwen3 ASR WS 客戶端（讀 Purpose 設定） |
| `python/oaao_orchestrator/live_meeting/hub.py` | 註冊 session、廣播 SSE |
| `python/oaao_orchestrator/streaming/events.py` | 新增 `KIND_LIVE_TRANSCRIPT`（或 phase 常數） |

### 7.5 Endpoints（可選 M1）

| 路徑 | 動作 |
|------|------|
| `endpoints/default/controller/endpoints.php` | 註冊 purpose 前綴 `live_meeting`（M2 用；M1 可僅 asr） |

### 7.6 基礎設施

| 路徑 | 動作 |
|------|------|
| `docker/web/docker-entrypoint.sh` | `mkdir data/live-meeting` |
| `OAAO_LIVE_MEETING_ROOT` | 預設 `/var/www/html/sites/oaaoai/oaaoai/data/live-meeting` |

---

## 8. API 契約（M1）

### POST `/live-meeting/api/session_start`

Request JSON:

```json
{ "cadence": "1v1", "workspace_id": 1, "retention_mode": "disk_ttl" }
```

Response:

```json
{
  "success": true,
  "data": {
    "session_id": "lm_…",
    "ws_audio_url": "/v1/live/lm_…/audio",
    "stream_url": "http://orchestrator:8103/v1/live/lm_…/stream",
    "stream_token": "…"
  }
}
```

### POST `/live-meeting/api/session_stop`

```json
{ "session_id": "lm_…", "keep_audio": false }
```

### SSE（orchestrator）

`event: message` + `StreamEnvelope` payload，`kind=live_transcript`。

### WS（orchestrator）

Binary frames：PCM s16le mono 16kHz；或 JSON `{ type: "ping" }` 心跳。

---

## 9. 實作順序（建議 PR 切分）

1. **PR-A 基礎**：`LiveMeetingStorage` + docker 掛載 + `session_start/stop` 空殼 + SPA 頁空白  
2. **PR-B 音訊**：`live-meeting-audio.js` + WS 接收 + 落盤 segment  
3. **PR-C ASR**：`qwen_asr_stream.py` + SSE transcript  
4. **PR-D UI**：逐字稿區 + 錄音狀態 + 停止/保留  

---

## 10. 待提供（實作 PR-C 前）

- Qwen3-ASR Streaming 的 **WebSocket URL 路徑、auth、binary 格式**（對齊你們已部署的 endpoint 文件）  
- Materials 檢索範圍：僅 workspace Vault（預設）  

---

## 11. 相關文件

- `docs/backlog/chat-task-pipeline.md` — SSE / StreamEnvelope 心智模型  
- `docs/backlog/vault-asr-speaker-mode.md` — 批次 ASR（與 Live 分離）  
- `.cursor/rules/rayfung-razy-stack.mdc` — PHP 禁止 SSE 長連線  
