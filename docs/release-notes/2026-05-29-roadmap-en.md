# What's new — late May 2026

**Shipped from 27 May 2026 through today.** This is the first **news** post in the workspace bell and **What's New** dialog.

## Chat & orchestration

- **Web search** — Purpose-aware LLM routing, SearXNG, composer **Force web search**, and locale-aware result filtering.
- **Composer** — Multi-line input, **pipeline / planner steps** toggle, planner modes (Default / ToT / DDTree), **credits** on send, and **context usage** ring with optional **CIT/CMT** compaction when the thread is nearly full.
- **Truncated replies** — **Continue** on assistant messages that hit the output token limit (append to the same bubble).
- **Voice** — Live and batch ASR on the composer with stop-time LLM polish.
- **Inference control v2** — Composer **Off / Auto / Manual**; baseline from system + user preferences; per-turn planner **`inference_delta`** (see `docs/design/chat-inference-auto-tune.md`).
- **Message feedback (UX-1)** — **Thumbs up / down** on assistant replies; **downvote** applies a small bounded tweak to your saved **model params** (temperature / penalties) with an audit trail in preferences.

## Vault, library & content

- **Vault phase 2** — Ingest progress over SSE, HTML split pipeline, graph transcript fixes, card layout, and job backpressure fixes.
- **Library workspace** — Dedicated **Library** rail, block editor shell, **@library** attach in chat (soft-RAG only when attached; separate from Vault auto-source).
- **Corpus** — Schema-driven analyze (`document_type` registry), dual markdown / HTML-template output, render jobs for HTML/PDF preview.
- **Slides** — Web-to-slide pipeline fixes; slide-designer autoload aligned with Razy module libraries.

## Platform & settings

- **Per-tenant storage** — Local / S3 / GCS / HF backends and migration UI.
- **Endpoints** — CLI **export/import** for endpoints and purpose bindings (**26B** for full-context chat, **E4B** for planner — see Settings → Purposes).
- **Release notes (PLAT-1)** — Platform CMS, **What's New** dialog, build-line deep link, batched **cross-tenant notification** fan-out when a post is published (this article).
- **Personalization** — Guided preference wizard, personality packs, Advanced model params panel, **Re-tune** in Settings.
- **Admin & ops** — User usage overview, notification dropdown styling, Redis canary, orchestrator health gating.

## Product direction (docs)

- **Content Studio** epics: **Calendar agent** (rail), **Todo agent** (header), **ERP business workspace** north-star (`docs/design/erp-business-workspace.md`).

## How to try

1. **Hard-refresh** the workspace after deploy (shell ESM cache rev on chat/core assets).
2. Open **Settings → Endpoints** and **Preferences** for locale, inference, and personalization.
3. Start a chat — enable **web search** or **pipeline steps** when needed; use **thumbs down** once to nudge params if replies feel too verbose.
4. Open the **bell** — tap this **news** item to read the full post in **What's New**.

Report issues with your **build_id** from the workspace footer or `GET /api/build_info`.
