# Design pack — Corpus Studio (EPIC-CS-1)

| Field | Value |
|-------|--------|
| **Status** | v1.0 — ready to implement |
| **Epic** | EPIC-CS-1 |
| **Milestone** | Content-Studio-2026 |
| **Sprint** | CS-W1 (S1–S5) · CS-W2 (S6–S8) · CS-W4 (S9–S11) |
| **Authoritative spec** | [OAAO_Content_Studio_Epics.md §3](../OAAO_Content_Studio_Epics.md) |

---

## 1. Scope

### In scope

- Workspace page **`workspace/corpus`** (gallery layout, like `workspace/templates`).
- Module **`oaaoai/corpus`** (`module.php`, `controller/api/*`, `webassets/`, `view/*.tpl`).
- Entities: profile, source, segment; statuses `draft` → `learning` → `ready` \| `error`.
- Sources: **upload** (tenant storage) · **vault_container** · **vault_document** (ref only).
- Orchestrator: `POST /v1/corpus/analyze`, progress via poll v1 (SSE optional pre-GTM).
- Style `style_json` v1; Corpus page Re-analyze + manual edits.
- Chat: `corpus_id` on run (CS-1-S10, CS-W4).

### Out of scope (this pack)

- Full Library editor (EPIC-CS-2).
- Office export (EPIC-CS-3).
- `contracts/v1` corpus schemas (CS-P-S4 — ship with S11 or pre-GTM).
- Dedicated `StorageDomain::CORPUS` bulk migration tooling (use new domain constant; bulk migrate pre-GTM).

### Pre-GTM

- Vault ingest SSE phase 2; Redis queue canary.

---

## 2. UX & shell integration

| Item | Pattern reference |
|------|-------------------|
| Layout | Add `workspace/corpus` to `GALLERY_LAYOUT_PAGE_IDS` in [workspace.js](../../backbone/sites/oaaoai/oaaoai/core/vite/public/js/workspace.js) (mirror templates) |
| Registration | `$coreApi->registerSpaPage('workspace/corpus', …)` in corpus `__onReady` (see [core.php](../../backbone/sites/oaaoai/oaaoai/core/default/controller/core.php) templates block) |
| Gallery UI | Card grid + empty state; detail drawer or secondary route `workspace/corpus/{id}` via SPA hash |
| Vault picker | Reuse vault scope APIs from vault module (folder + multi-doc selection) |

**Icon suggestion:** `book-marked` or `library-big` (Lucide name passed to SpaRegister).

---

## 3. Data model (PostgreSQL + SQLite adjunct)

### `oaao_corpus_profile`

| Column | Notes |
|--------|--------|
| corpus_id | PK |
| tenant_id | FK |
| workspace_id | nullable scope |
| name, description | |
| tags_json | JSON array |
| style_json | JSON object v1 schema (see §5) |
| status | `draft` \| `learning` \| `ready` \| `error` |
| error_message | nullable |
| created_by, created_at, updated_at | |

### `oaao_corpus_source`

| Column | Notes |
|--------|--------|
| source_id | PK |
| corpus_id | FK |
| kind | `upload` \| `vault_container` \| `vault_document` |
| locator_json | storage locator or `{ vault_id, container_id?, document_id? }` |
| label | optional display name |
| sort_order | int |

### `oaao_corpus_segment`

| Column | Notes |
|--------|--------|
| segment_id | PK |
| corpus_id | FK |
| source_id | nullable |
| text | excerpt |
| classify_json | `{ genre, audience, tone, domain, language, … }` |
| ordinal | int |

**ACL:** same workspace membership checks as vault list (tenant + workspace_id).

---

## 4. PHP API (lazy routes)

| Story | Endpoint | Notes |
|-------|----------|--------|
| CS-1-S3 | `GET corpus_profiles_list` | status, source_count, tags |
| CS-1-S13 | `POST corpus_profile_render` | enqueue `POST /v1/corpus/render`; poll `corpus_job_poll` |
| CS-1-S3 | `POST corpus_profile_save` | create/update |
| CS-1-S3 | `POST corpus_profile_delete` | |
| CS-1-S4 | `POST corpus_source_upload` | multipart → `StorageDomain::CORPUS` (new constant in `StorageDomain.php`) |
| CS-1-S5 | `POST corpus_source_vault_ref` | validate vault ACL |
| CS-1-S8 | `POST corpus_profile_analyze_enqueue` | calls orchestrator with internal token |
| CS-1-S8 | `GET corpus_profile_status` | poll job + segments preview |

JSON envelope: existing oaao SPA `result` / `message` / `data`.

---

## 4.1 商品化：禁止 domain hard code

與 [OAAO_Content_Studio_Epics.md §0.1](../OAAO_Content_Studio_Epics.md) 對齊：

- **不要** 在 `segmenting.py` / `html_template.py` 為新公文類型加 regex／固定五欄／固定標題字串。
- **要** `document_type` + `contracts/v1` schema + 版面 Markdown ingest（CS-1-S15–S18）。
- MVP 現有 HK 通告启发式視為 **技術債**；修 bug 時優先 **收斂到 schema**，而非複製規則。

**目標 analyze 鏈（簡圖）：** `extract → document_markdown → classify type → schema extract (validate) → segments + style + html_template(from schema)`.

**S15（已接入）：** `corpus/document_markdown.py` — analyze 前 **LLM-first** 結構化 Markdown（`llm_cfg` / LoRA endpoint）；`OAAO_CORPUS_MARKDOWN_INGEST=llm|heuristic|off`。稽核報告：[Intelligence-vs-Hardcode-Audit.md](../reports/Intelligence-vs-Hardcode-Audit.md)。

---

## 5. Orchestrator (Python)

| Story | Route | Behavior |
|-------|-------|----------|
| CS-1-S6 | `POST /v1/corpus/analyze` | body: `corpus_id`, tenant context; extract segments (reuse vault text extract helpers); classify |
| CS-1-S7 | (same job tail) | LLM style extraction → `style_json` |
| CS-1-S9 | `POST /v1/corpus/generate` | brief + profile → sample markdown (preview only) |
| CS-1-S12 | `POST /v1/corpus/template/build` | segments → `corpus_html_template_v1` (also embedded on analyze in `style_json.meta`) |
| CS-1-S13 | `POST /v1/corpus/render` | `format=html\|pdf` + parameters → HTML doc; PDF via weasyprint (CS-3-S3) |
| CS-1-S15–S18 | (analyze 擴充) | Layout Markdown + document_type + two-pass extraction + schema-driven template — see Epics §3.2 |

**Progress v1:** Browser polls PHP (`corpus_profile_status`, `corpus_job_poll`); each PHP request does **at most one** short orchestrator `GET /v1/corpus/jobs/{id}` — **no browser SSE to PHP**, **no PHP wait loop** for job completion.

**PHP boundary (硬性):** upload → storage locator + ACL only; `CorpusAnalyzePayload` resolves **paths** (no text extract); analyze/generate/render **enqueue** with `background: true`; apply results via `CorpusAnalyzeApply` after poll. **Never** parse PDF, LLM, or weasyprint in PHP.

**Chat (CS-1-S10):** extend `ChatRunRequest` + [chat run route](../../python/oaao_orchestrator/routes/chat.py); planner inject compact style block from `style_json`.

### `style_json` v1 (minimal schema)

```json
{
  "version": 1,
  "structure": { "sections": [], "heading_style": "" },
  "lexicon": { "preferred_terms": [], "avoid_terms": [] },
  "formatting": { "list_style": "", "citation_style": "" },
  "tone": "",
  "dos": [],
  "donts": []
}
```

---

## 6. Task breakdown → Jira

| Sprint | Stories | Deliverable |
|--------|---------|-------------|
| **CS-W1** | CS-1-S1…S5 | Sidebar page, CRUD, sources (no analyze) |
| **CS-W2** | CS-1-S6…S8 | Analyze job E2E, detail UI |
| **CS-W4** | CS-1-S9…S11 | Preview generate, chat contract, tests + `contracts/v1/corpus.*.json` |

---

## 7. KPI & acceptance

| KPI ID | Definition | Target | Measured |
|--------|------------|--------|----------|
| **cs1_page_live** | `workspace/corpus` loads empty gallery | staging | smoke |
| **cs1_source_mix** | 1 upload + 1 vault ref on same profile | manual QA | checklist |
| **cs1_analyze_p95** | analyze job wall time (≤3 sources, ≤50 pages total) | P95 ≤ 10 min staging | orchestrator timing log |
| **cs1_ready_rate** | profiles reaching `ready` without error | ≥ 90% on golden fixtures | integration test |
| **cs1_chat_style_delta** | same prompt with/without `corpus_id` | blind review ≥ 70% prefer match | manual once |
| **cs1_segment_cap** | segments per profile | hard cap 500 (config) | enforce in analyze |

**Epic DoD (from Epics):** Upload or Vault ref → analyze → edit style → Chat with corpus shows style difference.

---

## 8. Dependencies

| Dependency | Status |
|------------|--------|
| Tenant storage | ✅ `StorageLocator` / `StorageDomain` |
| Vault extract | ✅ orchestrator vault pipelines |
| Workspace shell | ✅ `registerSpaPage` + gallery layout |
| Credit ledger | 🟡 watch analyze cost ([credit-top-up backlog](../../backbone/sites/oaaoai/oaaoai/docs/backlog/credit-top-up-and-consumption.md)) |

---

## 9. Implementation order (first 5 days)

1. **CS-1-S1** module skeleton + SPA + i18n  
2. **CS-1-S2** migrations  
3. **CS-1-S3** CRUD APIs  
4. **CS-1-S4** upload + `StorageDomain::CORPUS`  
5. **CS-1-S5** vault ref picker  
6. (CS-W2) wire analyze + UI  

**Spike not required** for gallery (templates precedent exists). **Required before CS-W2:** internal token + PHP enqueue pattern copied from vault jobs.
