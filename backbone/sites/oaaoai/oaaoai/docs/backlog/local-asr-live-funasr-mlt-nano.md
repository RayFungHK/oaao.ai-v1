# Backlog：ASR-Live — FunASR Nano 串流 + Input（Purpose `asr.live.*`）

> **狀態**：Phase A/B **OAAO 接線已完成**（2026-05-25）；推理服務 **https://funasr-nano.rayfung.hk** + **wss://funasr-nano-ws.rayfung.hk** 已部署  
> **待做（ops）**：WS proxy 回傳 `transcript`/`partial` JSON（目前僅 `ack` → Live 仍走 ~5 s batch fallback）  
> **待做（產品）**：`docker compose --profile funasr-live` 本地 GPU sidecar（§6，非 Nano 遠端路徑）  
> **目標**：Composer + Live Meeting **streaming partial/final**（首選）與 **segment batch fallback**；Vault 批次 **`asr.*`** 分離。  
> **已部署端點**：**https://funasr-nano.rayfung.hk/**（`GET /health` → `FunAudioLLM/Fun-ASR-Nano-2512`）  
> **硬性規則**（沿用 Live M1）：瀏覽器 PCM 仍經 **Python orchestrator**（WS 上行、SSE 下行）；PHP 只做 session、ACL、**`asr.live.*` Purpose** 設定。

**相關**：[live-meeting-assistant-m1.md](./live-meeting-assistant-m1.md) · [vault-asr-speaker-mode.md](./vault-asr-speaker-mode.md) · `docs/phase-live-asr-assistant.md` · [scheduled-article-research.md](./scheduled-article-research.md)（無直接依賴）

### 0.1 產品分層（凍結）

| 層級 | 機制 | 體驗 | 角色 |
|------|------|------|------|
| **Primary** | Duplex WS streaming（partial ~300–800 ms） | 超快輸入、Live Meeting 即時字幕 | **企業價值主路徑** |
| **Fallback A** | 關閉 ~5 s PCM segment → `POST /transcribe` | 可用、延遲較高 | Nano 未接 WS 或 stream 斷線過渡 |
| **Fallback B** | `input_fallback` → batch `asr.*`（如 Qwen） | 最後手段 | Live transcribe HTTP 失敗 |

PTT（按麥開始/結束）是 **UI 互動**；Primary 仍可在按住期間 **邊說邊出 partial**（streaming），不是等鬆手才整段 transcribe。

---

## 0. 已部署 FunASR Nano 服務（2026-05）

| 項目 | 值 |
|------|-----|
| **Base URL** | `https://funasr-nano.rayfung.hk` |
| **Health** | `GET /health` → `{ "ok": true, "model": "FunAudioLLM/Fun-ASR-Nano-2512" }` |
| **OpenAPI** | `GET /openapi.json` |
| **Input（批次）** | `POST /transcribe` — body `{ "input": "<audio ref>", "language": "中文", "itn": true }` |
| **Live streaming** | Orchestrator 橋接 WS（路徑待與 ops 凍結；若僅 HTTP，Phase A 可 chunk+buffer 過渡，**非最終方案**） |

**與本 repo 內建 sidecar 關係**：

| 服務 | 位置 | 用途 |
|------|------|------|
| `funasr`（compose profile） | Docker 內 `8765` | Vault **Speaker** 整段 diarization |
| **FunASR Nano（外部）** | `funasr-nano.rayfung.hk` | **ASR-Live** streaming + input |
| `funasr-live`（compose，可選） | 未內建 | 與外部二選一；on-prem 可改指向內網同名 API |

**OAAO 仍缺**：Settings **`asr.live.*` slot**、`resolveLiveAsrBinding()`、composer / `session_start` 改讀 live payload、`FunasrNanoBridge`（streaming + transcribe fallback）。

---

## 1. 背景與動機

| 現況 | 問題 |
|------|------|
| Live ASR 走 DashScope WebSocket（`dashscope_asr_stream.py`） | Qwen3-ASR Realtime **延遲偏高**；按 token 計費 |
| 內建 FunASR sidecar（`docker/funasr_adapter`） | 僅 **HTTP 批次** + Vault **Speaker** diarization；**不接** Live PCM 串流 |
| Purpose 僅一個 `asr.*` binding | Vault 批次 ASR 與 Live 無法分離（Qwen 批次 + 本地 Live） |
| 外部 **Fun-ASR-Nano** 已上線 | OAAO 尚未註冊 **`asr.live.primary`**，composer 仍走 DashScope `asr.*` |

**已部署模型**：**Fun-ASR-Nano-2512**（方言/中文優先）。**Fun-ASR-MLT-Nano-2512**（31 語）仍為可選升級 — 同一 Purpose 以 `meta_json.model` 切換，base URL 可共用或另部署。

---

## 2. 產品決策（待實作前凍結）

| # | 決策 |
|---|------|
| 1 | Live 路徑新增 **`provider: funasr_nano`**（遠端）或 `funasr_local_stream`（同機 sidecar），與 DashScope `streaming` **互斥** |
| 2 | 新增 Purpose slot **`asr.live.*`**（`collect_feature_registries` 註冊 **`pa-asr-live`**）— Composer 麥克風 + Live Meeting **只**讀此 binding；Vault 批次仍用 `asr.*` |
| 3 | 預設遠端 base：`https://funasr-nano.rayfung.hk`；模型 id 與 `/health` 一致或 admin 覆寫 |
| 3b | **雙模式**：`mode: streaming`（Live partial/final）+ `mode: input`（`POST /transcribe` 整段或 push-to-talk 結束包） |
| 4 | 音訊格式與現行一致：**16 kHz mono s16le PCM**（`live-meeting-audio.js`） |
| 5 | 延遲目標：partial **300–800 ms**（與 phase-live-asr-assistant 一致） |
| 6 | 無 GPU 時：**不** silently fallback 到 DashScope — Settings 明確提示或阻擋儲存 |

---

## 3. 架構（目標）

```text
Browser (composer mic / live-meeting)
  PCM 16kHz ──WS──► orchestrator /v1/live/{id}/audio
  EventSource ◄──SSE── live_transcript (partial / final)

Orchestrator hub.py
  ├─ [today]  DashscopeRealtimeAsrBridge  (asr.live + mode=streaming + cloud)
  └─ [new]    FunasrNanoBridge            (asr.live + provider=funasr_nano)
        │
        ├─ streaming ──WS──► funasr-nano.rayfung.hk (PCM ↔ partial JSON)
        └─ input ──POST /transcribe──► 整段文字（fallback / PTT end）
        │
        ▼
  Fun-ASR-Nano-2512  (已部署) 或 MLT-Nano / 同機 funasr-live sidecar
```

**與現有 FunASR sidecar 關係**：

| 服務 | 用途 | 協議 |
|------|------|------|
| `funasr`（既有） | Vault Speaker 整段 diarization | HTTP POST `/v1/transcribe` |
| **`funasr-live`（新）** | Live 串流 ASR | WS duplex 或 orchestrator 同 process |

可共用 Docker 映像、分 **mode** / **model** env；不建議把 MLT-Nano 塞進既有 stub HTTP adapter 逐包 POST（延遲不可接受）。

---

## 4. Purpose / Settings

### 4.1 新 slot（Purpose allocation）

**Registry**（`collect_feature_registries.php` 新增）：

```php
PurposeAllocationRegister::add('pa-asr-live', 'ASR-Live', 'ASR-Live', '…', 'mic-vocal', [
    'sort' => 71,
    'purpose_key_prefix' => 'asr.live',
    'module_code' => 'oaaoai/endpoints',
    'label_key' => 'settings.slot.asr_live.label',
    'sub_key'   => 'settings.slot.asr_live.sub',
]);
```

| Slot | purpose_key 範例 | 用途 |
|------|------------------|------|
| ASR（既有） | `asr.primary` | Vault 上傳、批次 transcribe、chat 非 Live 語音 |
| **ASR-Live（新）** | `asr.live.primary` | Composer 麥克風 **streaming**、Live Meeting `session_start`、**input** 整段 transcribe |

`CanonicalEndpointsRepository::resolveLiveAsrBinding()` → `resolveVaultPurposeBinding('asr.live', 'asr.live.primary', 'asr.live')`。

`buildLiveMeetingOrchestratorExtras()` / `rag-composer-voice` 改呼叫 **`resolveLiveAsrBinding()`**，不再共用 `resolveAsrBinding()`。

### 4.2 `asr.live` `meta_json`（草案 — 接已部署 Nano）

```json
{
  "provider": "funasr_nano",
  "mode": "streaming",
  "model": "FunAudioLLM/Fun-ASR-Nano-2512",
  "funasr_base_url": "https://funasr-nano.rayfung.hk",
  "funasr_stream_url": "wss://funasr-nano.rayfung.hk/v1/live/asr",
  "language": "中文",
  "itn": true,
  "input_fallback": true
}
```

**Input 模式範例**（push-to-talk 或短句）：

```json
{
  "provider": "funasr_nano",
  "mode": "input",
  "funasr_base_url": "https://funasr-nano.rayfung.hk",
  "language": "yue"
}
```

| 欄位 | 說明 |
|------|------|
| `provider` | `funasr_nano` \| `funasr_local_stream` \| `dashscope` |
| `mode` | `streaming`（Live partial/final）\| `input`（`POST /transcribe`） |
| `funasr_base_url` | HTTP API 根（health、transcribe） |
| `funasr_stream_url` | WS 串流（與 ops 凍結；未公開前 bridge 可 stub） |
| `language` / `itn` | 對應 OpenAPI `TranscribeRequest` |
| `input_fallback` | streaming 斷線時是否改送最後 PCM buffer 至 `/transcribe` |

Settings → 新增 **「ASR-Live」** slot（與 **ASR** 分開）：preset **FunASR Nano（遠端）**、自訂 base URL、語言、**Ensure**（`GET /health` + 可選試 transcribe）。

---

## 5. 實作分期

### Phase A — Purpose + 遠端 Nano Input（可立即接線）

| 任務 | 路徑 / 說明 |
|------|-------------|
| `resolveLiveAsrBinding()` | `CanonicalEndpointsRepository.php` |
| `resolveOrchestratorLiveAsrPayload()` | `endpoints.php` |
| **`pa-asr-live` registry** | `collect_feature_registries.php` |
| `AsrLivePurposeConfig` 或擴充 `AsrPurposeConfig` | 透傳 `funasr_nano` 欄位 |
| `session_start` / composer 只吃 live payload | `chat.php`, `rag-composer-voice` |
| **`FunasrNanoInputBridge`** | `POST {base}/transcribe` — input 模式 |
| **`funasr_nano_ensure.php`** | `GET /health` 對 `funasr-nano.rayfung.hk` |
| Settings **ASR-Live** 表單 | `asr-live-settings-form.js` |

**驗收**：Settings 設 `asr.live.primary` → Ensure 綠燈；input 模式短音訊得文字；**仍不走** `asr.primary` DashScope。

### Phase B — Streaming bridge + WS 協議

| 任務 | 路徑 / 說明 |
|------|-------------|
| **`FunasrNanoStreamBridge`** | `live_meeting/funasr_nano_stream.py` — WS 對 `funasr_stream_url` |
| WS 協議凍結 | binary PCM in → JSON `{ text, is_final }` — 對齊 `DashscopeRealtimeAsrBridge.on_emit` |
| hub 分支 | `live_meeting/hub.py` — `provider=funasr_nano` + `mode=streaming` |
| 可選同機 sidecar | `docker/funasr_live_adapter/` profile `funasr-live`（與遠端 API 同契約） |
| Glossary hotwords | 若 Nano WS 支援 |
| Composer 開麥 E2E | partial italic + final 與 DashScope 路徑一致 |

**驗收**：開麥 10s 內 partial；log `funasr_nano_stream model=Fun-ASR-Nano-2512`；Network 顯示 orchestrator→`funasr-nano.rayfung.hk`。

### Phase C — 維運與文件

| 任務 | 說明 |
|------|------|
| `docker/env.example` | `OAAO_FUNASR_LIVE_*`、`FUNASR_LIVE_MODEL` |
| README profile 表 | `--profile funasr-live` |
| `Test_Catalog.md` | 新增 bridge 單元測試、`test_funasr_local_stream*.py` |
| i18n | `settings.asr.live_*` keys |

---

## 6. 檔案清單（預估）

### Python orchestrator

| 路徑 | 動作 |
|------|------|
| `live_meeting/funasr_nano_stream.py` | **新增** — `FunasrNanoStreamBridge` |
| `live_meeting/funasr_nano_input.py` | **新增** — `POST /transcribe` |
| `live_meeting/hub.py` | 分支 `_ensure_funasr_local_bridge`、PCM 轉發 |
| `live_meeting/qwen_asr_stream.py` | `use_funasr_local_stream()` 旗標 |
| `tests/test_funasr_local_stream.py` | stub + 訊息解析 |

### PHP / Settings

| 路徑 | 動作 |
|------|------|
| `endpoints/.../CanonicalEndpointsRepository.php` | `resolveLiveAsrBinding()` |
| `endpoints/.../AsrPurposeConfig.php` | live meta 欄位 |
| `endpoints/.../endpoints.php` | `resolveOrchestratorLiveAsrPayload()` |
| `endpoints/.../api/funasr_nano_ensure.php` | **新增** — health + 可選 transcribe smoke |
| `core/.../oaao-asr-settings-panel.js` | Live 分頁 / preset |
| `core/.../asr-settings/asr-live-settings-form.js` | **新增** |

### Docker

| 路徑 | 動作 |
|------|------|
| `python/funasr_live_adapter/` | **新增** — WS server + AutoModel 串流 |
| `docker/funasr_live_adapter/Dockerfile` | CUDA base 或 runtime + 模型 volume |
| `docker-compose.yml` | `funasr-live` service、`profiles: ['funasr-live']` |

---

## 7. 非目標（本 backlog 不做）

- 把 MLT-Nano 掛進既有 **HTTP** `funasr` sidecar 當 Live（延遲不合格）
- 在瀏覽器跑 WASM / WebGPU 推理
- 取代 Vault Speaker Mode 的 CAM++ diarization（仍用既有 `funasr` HTTP）
- 多 orchestrator 實例共享單一 GPU 串流（Phase B 僅 single-node）

---

## 8. 風險與依賴

| 風險 | 緩解 |
|------|------|
| MLT-Nano 需 `remote_code` / 特定 funasr 版本 | Pin 版本 + CI smoke |
| GPU 記憶體（~800M + VAD） | 文件標明最低 VRAM；CPU fallback 標為 experimental |
| 與 Qwen 並存時 Purpose 搞混 | UI 分開 slot + `purpose_key` 寫入 usage event |
| Windows Docker GPU | 文件指向 WSL2 + NVIDIA Container Toolkit |

---

## 9. 驗收清單（全案）

- [x] Settings 可選 **ASR-Live → FunASR Nano（`wss://funasr-nano-ws…`）**，與 **ASR → Qwen 批次** 獨立儲存
- [x] Purpose slot **`asr.live.*`** 出現在 Settings → Purpose allocation
- [x] Live Meeting：orchestrator log `stream_bridge_ready` / `funasr_nano_ws_started`；Network WS/SSE 正常
- [x] Batch fallback：`asr.*` slot → segment `segment_transcribed`（~5 s）；`batch_protocol` 路由 unified
- [ ] **Upstream**：WS proxy 送 `partial`/`transcript` → UI 斜體 partial（blocked on ops）
- [ ] Input 模式：`POST /transcribe` 可從 orchestrator 成功轉寫（Composer push-to-talk）
- [ ] 關閉 sidecar 時 Settings 阻擋或明確錯誤（不 silent 走雲端，除非 admin 勾選 fallback）
- [ ] `docker compose --profile funasr-live up` 一鍵起本地 Live ASR

---

## 10. 參考

- 開源模型：[Fun-ASR-MLT-Nano-2512](https://huggingface.co/FunAudioLLM/Fun-ASR-MLT-Nano-2512) · [Fun-ASR repo](https://github.com/FunAudioLLM/Fun-ASR)
- 現行雲端 Live：`python/oaao_orchestrator/live_meeting/dashscope_asr_stream.py`
- 現行本地批次 FunASR：`python/funasr_adapter/app.py`、`docs/backlog/vault-asr-speaker-mode.md`
