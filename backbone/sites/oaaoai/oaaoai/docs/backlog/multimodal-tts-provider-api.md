# Backlog：Multimodal / TTS Provider API — Supertonic 3 & Lance

> **狀態**：延後實作（產品規格 · 2026-05-22）  
> **共同要求**：兩項能力都必須走 **可替換的 Provider API**（Settings → Purpose → Endpoint），讓開發／維運能在不改 chat / vault / orchestrator 核心程式的前提下 **換模型、換部署位址、換 vendor**。  
> **對齊既有模式**：`AsrPurposeConfig`、`UiqePurposeConfig`、`resolveOrchestrator*Payload()`、`PurposeAllocationRegister`。

---

## 摘要

| # | 模型 | Hugging Face | 建議 Purpose 前綴 | 能力 |
|---|------|--------------|-------------------|------|
| 1 | **Supertonic 3** | [Supertone/supertonic-3](https://huggingface.co/Supertone/supertonic-3) | `tts.*` | 本地 ONNX TTS，31 語言，CPU/on-device |
| 2 | **Lance 3B** | [bytedance-research/Lance](https://huggingface.co/bytedance-research/Lance) | `multimodal.*` / `vision.*` | 圖/視頻 **理解、生成、編輯**（any-to-any unified） |

---

## 1. 共同架構：Swappable Provider API

### 1.1 設計原則

| 原則 | 說明 |
|------|------|
| **Purpose 是唯一路由入口** | UI / orchestrator / vault 只認 `purpose_key` + `meta_json`，不 hard-code HF repo 或本地 binary 路徑。 |
| **Endpoint 綁定可換** | 同一 `tts.primary` 今天指 Supertonic sidecar，明天可改 OpenAI `/v1/audio/speech` 或 XTTS，只改 Settings。 |
| **Orchestrator 薄 HTTP 邊界** | Python 只實作 **adapter**（`supertonic_adapter.py`、`lance_adapter.py`）+ 統一 REST；PHP 用 `ChatOrchestratorApi::postInternalJson` 或 job payload 透傳。 |
| **產物走 artifact 契約** | 生成結果（wav / png / mp4）寫 vault 或 run artifact URI；理解結果回 text/json 進 SSE envelope。 |
| **Credit / usage 可掛** | 與 ASR / chat 相同：`oaao_usage_event` + purpose `meta_json.credit_multiplier`。 |

### 1.2 三層 API（開發者視角）

```text
Settings (Razy UI)
  oaao_purpose.purpose_key  +  meta_json.provider
  oaao_purpose.default_endpoint_id  →  oaao_endpoint.base_url / model / api_key_ref
        │
        ▼
PHP *PurposeConfig::jobPayloadFromBinding()   ← 開發者擴充點（仿 AsrPurposeConfig）
        │
        ▼
Orchestrator internal REST
  POST /v1/tts/synthesize
  POST /v1/multimodal/{task}     task ∈ t2i | t2v | image_edit | video_edit | x2t_image | x2t_video
        │
        ▼
Provider adapter (可替換)
  provider: supertonic | openai_compat | lance_local | lance_http | …
```

### 1.3 建議 internal REST 契約（草案）

#### TTS — `POST /v1/tts/synthesize`

```json
{
  "text": "Hello world",
  "lang": "en",
  "voice_style": "M1",
  "format": "wav",
  "provider": {
    "purpose_key": "tts.primary",
    "base_url": "http://supertonic:8200",
    "model": "supertonic-3",
    "api_key_env": null,
    "meta": { "provider": "supertonic", "expression_tags": true }
  }
}
```

Response: `{ "ok": true, "audio_base64": "…", "duration_sec": 1.23, "content_type": "audio/wav" }`  
或 `{ "ok": true, "artifact_uri": "vault://…" }`（大檔）。

#### Multimodal — `POST /v1/multimodal/run`

```json
{
  "task": "t2i",
  "prompt": "…",
  "inputs": { "image_uri": null, "video_uri": null },
  "params": {
    "resolution": "image_768res",
    "num_frames": 121,
    "seed": 42
  },
  "provider": {
    "purpose_key": "multimodal.primary",
    "base_url": "http://lance:8300",
    "model": "Lance_3B",
    "meta": { "provider": "lance_local", "gpu_count": 1 }
  }
}
```

Response（生成）: `{ "ok": true, "artifact_uri": "…", "mime": "image/png" | "video/mp4" }`  
Response（理解）: `{ "ok": true, "text": "…", "structured": { … } }`

**Task 對照（Lance 官方）**：

| `task` | 說明 |
|--------|------|
| `t2i` | Text-to-Image |
| `t2v` | Text-to-Video |
| `image_edit` | Image editing |
| `video_edit` | Video editing |
| `x2t_image` | Image understanding (VQA / caption) |
| `x2t_video` | Video understanding (VQA / caption) |

---

## 2. Supertonic 3 — TTS Purpose

**來源**：[Supertone/supertonic-3](https://huggingface.co/Supertone/supertonic-3) · ONNX · ~99M params · 31 languages · CPU-friendly · OpenRAIL-M。

### 2.1 產品用途

| 場景 | 說明 |
|------|------|
| Chat 語音回覆 | Live meeting / assistant 語音輸出（補 `live-meeting-assistant-m1.md` 明確排除的 TTS） |
| Vault / transcript | 摘要朗讀、accessibility |
| 多語 | `lang` 對照 HF card（`en`, `zh`→需確認 code、`ja`, `ko`, …） |

### 2.2 建議 Purpose 註冊

| 欄位 | 值 |
|------|-----|
| `slot_id` | `tts` |
| `purpose_key_prefix` | `tts` |
| 預設 key | `tts.primary` |
| `TtsPurposeConfig` | 新檔 `endpoints/default/library/TtsPurposeConfig.php` |

### 2.3 Settings `meta_json` 範例

**Supertonic 本地 sidecar：**

```json
{
  "provider": "supertonic",
  "voice_name": "M1",
  "lang_default": "en",
  "expression_tags": true,
  "sidecar_base_url": "http://supertonic:8200"
}
```

**OpenAI-compat 替換（開發者換 endpoint 即可）：**

```json
{
  "provider": "openai_compat",
  "voice": "alloy",
  "response_format": "wav"
}
```

### 2.4 實作清單（未建）

- [ ] `TtsPurposeConfig::jobPayloadFromBinding()` + `purpose_allocation.register` slot
- [ ] `python/oaao_orchestrator/tts/` — `supertonic_adapter.py`, `openai_tts_adapter.py`, registry
- [ ] `POST /v1/tts/synthesize` in `app.py`
- [ ] Optional compose service `supertonic`（`pip install supertonic`, ONNX runtime）
- [ ] Chat UI：播放 assistant TTS（hook post-stream 或 user toggle）
- [ ] Usage / credit policy for synthesized seconds or chars
- [ ] Tests: mock provider swap (`provider=mock` → fixed wav bytes)

### 2.5 參考 SDK（HF）

```python
from supertonic import TTS
tts = TTS(auto_download=True)
style = tts.get_voice_style(voice_name="M1")
wav, duration = tts.synthesize(text, voice_style=style, lang="en")
```

Adapter 應包在 sidecar 進程內，orchestrator 只打 HTTP。

---

## 3. Lance — Image / Video Understanding, Generation, Editing

**來源**：[bytedance-research/Lance](https://huggingface.co/bytedance-research/Lance) · 3B active · Apache-2.0 · unified any-to-any · 需 GPU（CUDA 12.4+ 建議）。

### 3.1 產品用途

| 場景 | Lance task | 對齊 chat-task-pipeline |
|------|------------|-------------------------|
| 示意圖 / 封面 | `t2i` | `agent_kind=image_gen` |
| 短影片素材 | `t2v` | 新 `agent_kind=video_gen` |
| 修圖 / 去背 / 風格 | `image_edit` | artifact patch |
| 影片剪輯指令 | `video_edit` | vault / slide 素材 pipeline |
| 圖片 VQA / OCR 推理 | `x2t_image` | vault detail、chat attachment |
| 影片摘要 / VQA | `x2t_video` | vault meeting、live meeting recap |

### 3.2 建議 Purpose 註冊

可拆細或共用前綴：

| purpose_key | 用途 |
|-------------|------|
| `multimodal.primary` | 預設生成+理解路由 |
| `multimodal.image_gen` | 僅 t2i / image_edit |
| `multimodal.video_gen` | t2v / video_edit |
| `multimodal.vision` | x2t_image / x2t_video |

`MultimodalPurposeConfig.php` — 透傳 `task`, `resolution`, `model_path`, `num_gpus`。

### 3.3 Settings `meta_json` 範例

```json
{
  "provider": "lance_local",
  "model_path": "/models/Lance_3B",
  "video_model_path": "/models/Lance_3B_Video",
  "default_resolution": "image_768res",
  "num_gpus": 1,
  "sidecar_base_url": "http://lance:8300"
}
```

替換為 **遠端 HTTP 推理服務**（同一 REST 契約）：

```json
{
  "provider": "lance_http",
  "base_url": "https://internal-inference.example/v1/lance",
  "api_key_ref": "LANCE_API_KEY"
}
```

### 3.4 實作清單（未建）

- [ ] `MultimodalPurposeConfig` + purpose slots
- [ ] `python/oaao_orchestrator/multimodal/lance_adapter.py` — wrap `inference_lance.py` tasks
- [ ] `POST /v1/multimodal/run` + async job queue（t2v 可能 >30s）
- [ ] GPU compose profile（optional `lance` service, weights volume）
- [ ] Chat pipeline `image_gen` agent 改 call purpose API 而非 placeholder
- [ ] Vault: attachment preview / video understanding job type
- [ ] Artifact storage + MIME handling in `task_artifacts`
- [ ] Tests: task routing + provider mock

### 3.5 部署注意

- Lance weights 分 **image**（`Lance_3B`）與 **video**（`Lance_3B_Video`）路徑；purpose `meta_json` 需支援分模型。
- 推理耗 GPU；與 chat 31B 共用節點時需 **purpose 級 quota / 排隊**（可複用 evolution queue 模式）。
- HF 未提供 hosted Inference Provider；預期 **自架 sidecar** 為主。

---

## 4. 與其他 backlog / docs 的關係

| 文件 | 關係 |
|------|------|
| [live-meeting-assistant-m1.md](./live-meeting-assistant-m1.md) | M1 明確 **不含 TTS**；Supertonic 補語音輸出 |
| [chat-task-pipeline.md](./chat-task-pipeline.md) | `image_gen` agent → Lance `t2i`；可擴 `video_gen` |
| [vault-asr-speaker-mode.md](./vault-asr-speaker-mode.md) | ASR 輸入 ↔ TTS 輸出對稱；共用 Purpose/Endpoint 心智模型 |
| [OpenWebUI_Gap_Analysis.md](../../../../../docs/OpenWebUI_Gap_Analysis.md) §6 | TTS P1 缺口 → 本檔 Supertonic 3 |
| [credit-top-up-and-consumption.md](./credit-top-up-and-consumption.md) | 生成/秒數計費策略待訂 |

---

## 5. 建議實作順序

1. **Provider API 骨架** — `/v1/tts/synthesize`、`/v1/multimodal/run` + mock adapters + purpose slots（無 GPU 可測）。
2. **Supertonic 3** — CPU sidecar，Chat 語音回覆 MVP。
3. **Lance x2t** — 圖/視頻理解（vault + attachment），GPU 需求較低於 t2v。
4. **Lance t2i / image_edit** — 接 `image_gen` agent。
5. **Lance t2v / video_edit** — 非同步 job + artifact UX。

---

## 6. 開放問題

- [ ] Supertonic **中文** locale code（HF 表無 `zh`；需實測 `lang` 參數或對照表）
- [ ] Lance **授權**（Apache-2.0）vs Supertonic **OpenRAIL-M** — 產品 redist / 託管政策
- [ ] 是否統一 `provider: openai_compat` 作為第三選項（DALL·E / Sora API）與本地 Lance 並存
- [ ] 公開 tenant 是否預設關閉 video_gen（算力成本）
