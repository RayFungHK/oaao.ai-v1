# Backlog：Vault ASR — Normal Mode vs Speaker Mode（FunASR diarization）

> **狀態**：延後實作（產品規格 · 2026-05-19）  
> **參考 UI**：會議轉寫 — 左欄摘要／與會者／大綱；右欄依 **Speaker 1 / 2 / …** + 時間戳逐段 transcript；底部音訊播放列。  
> **決策**：有設定 diarization → **FunASR 本地** → **Speaker Mode**；未設定 → 維持現行 **Normal ASR Mode**（flat text + upload chunk）。

---

## 兩種模式（使用者可見）

| | **Normal ASR Mode**（預設） | **Speaker Mode** |
|---|---------------------------|-------------------|
| **觸發** | Settings → ASR purpose **未**啟用 diarization | ASR purpose `meta_json` 設 `provider: funasr` + `diarization_enabled: true` |
| **後端** | 現行 `asr_common.transcribe_audio_auto` → OpenAI-compat `/audio/transcriptions`（本地 Qwen / Whisper 等） | FunASR 本地（Paraformer + CAM++），**整段長音檔**優先，不走 24MiB 多 chunk 合併 |
| **輸出** | 單一 `source_text` 字串 | 結構化 **segments** + 扁平 `source_text`（供 embed） |
| **UI** | Vault detail：純文字 transcript（或無專用檢視） | **附圖布局**：Speaker 標籤、時間、气泡／卡片、與會者列表、可選摘要欄 |
| **Embed** | 整段文字切 chunk 向量化 | 以 **speaker 段落** 或 **時間段** 切 embed chunk（保留 `[S{n}]` 前綴） |

---

## Settings（後期）— ASR purpose `meta_json`

沿用 `AsrPurposeConfig` 擴充；**未設定或 `diarization_enabled` 為 false 時行為與今日完全一致**。

```json
{
  "provider": "openai_compat",
  "chunk_buffer_sec": 3
}
```

**Speaker Mode 範例：**

```json
{
  "provider": "funasr",
  "diarization_enabled": true,
  "speaker_count": 6,
  "language_hints": ["yue", "zh"],
  "funasr_base_url": "http://host.docker.internal:8765",
  "model": "paraformer-zh-v2",
  "enable_itn": true
}
```

| 欄位 | 說明 |
|------|------|
| `provider` | `openai_compat`（預設）\| `funasr` |
| `diarization_enabled` | `true` → Speaker Mode |
| `speaker_count` | 2–100，僅 **hint**（附圖約 6 人） |
| `language_hints` | 如 `yue` / `zh` / `en` |
| `funasr_base_url` | 本地 FunASR HTTP 服務（Docker 內用 `host.docker.internal` 或 sidecar 服務名） |
| `chunk_buffer_sec` | **僅 Normal Mode**；Speaker Mode 忽略 upload chunk |

`AsrPurposeConfig::jobPayloadFromBinding()` 應透傳 `provider`、`diarization_enabled`、`funasr_base_url` 等至 job `payload.asr`。

---

## 資料模型

### `oaao_vault_document.meta_json`（Speaker Mode 完成後）

```json
{
  "asr": {
    "mode": "speaker",
    "provider": "funasr",
    "duration_sec": 2777,
    "speaker_count": 6,
    "chunked": false,
    "segments": [
      {
        "speaker_id": 0,
        "speaker_label": "Speaker 1",
        "begin_ms": 1000,
        "end_ms": 9500,
        "text": "…"
      }
    ],
    "speakers": [
      { "speaker_id": 0, "label": "Speaker 1", "utterance_count": 42, "total_ms": 120000 }
    ]
  },
  "meeting": {
    "title": "2026年4月30日 OTC交易邏輯與價格定義確認會議",
    "outline": ["…"],
    "generated_at": "…"
  }
}
```

### `source_text`（embed 用 — 扁平 fallback）

Speaker Mode 仍寫入 `source_text`，格式建議：

```text
[00:00:01] Speaker 1: …
[00:00:10] Speaker 2: …
```

Normal Mode 維持現狀（無 speaker / 無時間戳，或僅 polish 後段落）。

### `speaker_label` 對應

- 預設 UI 顯示 **`Speaker {speaker_id + 1}`**（附圖 Speaker 1–6）
- 後期可允許使用者 **重新命名**（`speakers[].display_name`），不影響 `speaker_id`

---

## Pipeline

### Normal ASR Mode（現行，不變）

```
upload → vh.rag.audio_asr
  → ffmpeg
  → [若 >24MiB] ffmpeg segment → N 次 openai_compat transcribe → merge
  → optional polish (LLM)
  → source_text + meta_json.asr { mode:"normal", chunked, chunk_count }
  → enqueue vh.rag.document_embed
```

### Speaker Mode（新增）

```
upload → vh.rag.audio_asr
  → payload.asr.provider === "funasr" && diarization_enabled
  → POST funasr_base_url（整段 file / file path mount）
  → FunASR: ASR + CAM++ diarization
  → segments[] + speakers[]
  → build source_text（帶 [Speaker n] + 時間）
  → optional polish（**保留 speaker 標記**，或僅潤色逐段 text）
  → meta_json.asr.mode = "speaker"
  → enqueue embed（chunk 策略見下）
```

**硬性規則：Speaker Mode 不得** 走 `transcribe_audio_auto` 的 24MiB 多 chunk 路徑（會破壞 speaker 連續性）。長音檔由 **FunASR 本地 filetrans** 或 orchestrator 掛載同一 `storage_path` 一次處理。

---

## Orchestrator 改動（checklist）

- [ ] `asr_common.py`：`provider` 分支 — `openai_compat` | `funasr`
- [ ] 新模組 `asr_funasr.py`：呼叫本地 FunASR API，解析 `sentences[].speaker_id`, `begin_time`, `end_time`, `text`
- [ ] `vault_audio_asr.py`：Speaker Mode 時 `finish_extras.meta_json.asr.segments` + 結構化 `source_text`
- [ ] `AsrPurposeConfig.php`：meta 解碼 + job payload 透傳
- [ ] `vault_document_embed.py`：Speaker Mode 可選 **按 segment 邊界** 切 embed chunk（metadata 帶 `speaker_id`）

---

## UI — Speaker Mode（對齊附圖）

**入口**：Vault 文件 detail（audio / 已完成 ASR）→ **Transcript** 分頁或全屏檢視。

### 布局

```
┌─────────────────────┬──────────────────────────────────┐
│ 標題（檔名 / 會議名）  │  Transcript          [Copy][…]   │
│ About the meeting   │  ┌─ Speaker 1  00:00:01 ─────────┐ │
│  · Date / Time      │  │  轉寫段落…                      │ │
│  · Attendees        │  └────────────────────────────────┘ │
│    Speaker 1…6      │  ┌─ Speaker 2  00:00:10 ─────────┐ │
│  Outline（bullet）   │  │  …                             │ │
│  （Phase 2 LLM）     │  └────────────────────────────────┘ │
├─────────────────────┴──────────────────────────────────┤
│  ▶  ━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━  46:17 / 46:17  1×   │
└──────────────────────────────────────────────────────────┘
```

### 元件

| 元件 | 說明 |
|------|------|
| **Speaker 行** | Avatar（S1/S2…）、`Speaker n`、相對時間 `HH:MM:SS` |
| **Transcript 卡** | 單段文字；click → seek 音訊至 `begin_ms` |
| **Attendees** | 由 `meta_json.asr.speakers` 列出；人數 = diarization 結果 |
| **Outline / Summary** | **Phase 2**：ASR 完成後 optional LLM（vault summary purpose），非 Speaker Mode 必要條件 |
| **音訊列** | HTML5 `<audio>` 或波形；src = vault 原始檔 `/vault/...` 或 signed URL |

### Normal Mode UI

- 不顯示 Speaker 欄；僅 **單欄 plain transcript**（`source_text`）+ 音訊列（可選）
- 或維持現有 detail 不變，Speaker UI 僅在 `meta_json.asr.mode === "speaker"` 時啟用

**前端位置建議**：`vault/default/webassets/js/vault-transcript-speaker.js` + detail mount hook（JIT utility 排版，見 workspace JIT-first 規則）。

---

## 本地 FunASR 部署（運維備註）

- 獨立容器或宿主進程，暴露 REST（對齊 DashScope Fun-ASR filetrans 响应形状可減少解析代碼）
- orchestrator / web 需能讀 vault `storage_path` 或 FunASR 能 HTTP 拉檔
- GPU 建議；CAM++ diarization 與 Paraformer 同機
- **不** 與 Qwen3-ASR 強綁：Normal Mode 仍用使用者現有本地 Qwen endpoint

---

## 與其他 backlog 的關係

- **RAG scope**（`vault-rag-scope-controls.md`）：Speaker 段落 embed 後，citation 可顯示 `Speaker 2 › 00:12:…`
- **GraphRAG**：Speaker Mode 不改 graph hook；可選 Phase 3 把 speaker 寫入 entity metadata

---

## 實作階段

| Phase | 內容 |
|-------|------|
| **P0** | Settings meta + orchestrator FunASR 分支 + `meta_json.segments` + flat `source_text` |
| **P1** | Vault Speaker transcript UI（附圖右欄 + 音訊 seek） |
| **P2** | 左欄 meeting summary / outline（LLM，optional） |
| **P3** | Speaker 重新命名、embed chunk 帶 `speaker_id` filter、Chat 引用 speaker |
| **P4（可選）** | `provider: pyannote_qwen` 進階路徑（見前次架構討論） |

---

## 驗收標準

1. ASR purpose **無** diarization → 行為與 **今日 prod 完全一致**（含 chunk 3 份合併）。
2. 開啟 FunASR diarization → `meta_json.asr.mode === "speaker"`，segments ≥ 1，每段含 `speaker_id` + 時間。
3. UI 與附圖一致：多 Speaker 卡片 + 時間戳 + 底部播放。
4. 46min 級音檔 **不** 因 24MiB 被切成 3 段 ASR（Speaker Mode）。
5. embed 完成後 Chat RAG 可檢索帶 `[Speaker n]` 的內容。

---

## 參考檔案

- `python/oaao_orchestrator/asr_common.py` — Normal Mode
- `python/oaao_orchestrator/vault_audio_asr.py`
- `endpoints/default/library/AsrPurposeConfig.php`
- `vault/default/controller/vault.php` — `oaao_vault_merge_asr_job_payload`
- 阿里云 Fun-ASR / Paraformer `diarization_enabled` 响应字段（本地 FunASR 应对齐）
