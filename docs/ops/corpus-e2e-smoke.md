# Corpus Studio — E2E smoke (T2)

One path from **workspace/corpus** through analyze → poll → optional render.

## Preconditions

- Logged-in user with `workspace/corpus` SPA page registered.
- PostgreSQL + orchestrator up; `OAAO_ORCH_SHARED_SECRET` set.
- Corpus tables installed (`corpus` module `__onReady` migrate).

## Steps

| # | Action | API / UI |
|---|--------|----------|
| 1 | Open icon rail → **Corpus** | `workspace/corpus` gallery |
| 2 | **New profile** | `POST corpus/api/corpus_profile_save` |
| 3 | **Upload** source (PDF/txt/md) | `POST corpus_profile_source_upload` (multipart) |
| 4 | **Analyze** | `POST corpus_profile_analyze_enqueue` → job id |
| 5 | Poll until `ready` / `error` | `GET corpus_profile_status` or `corpus_job_poll` |
| 6 | Preview segments in card/detail | UI shows segment count + style tags |
| 7 | (Optional) **Render** HTML/PDF | `POST corpus_profile_render` → poll job |
| 8 | Chat with `corpus_id` on send | `POST chat/api/send` with corpus ref (CS-1-S10) |

## Expected

- Profile `status` transitions `draft` → `learning` → `ready` (or `error` with message).
- Orchestrator `POST /v1/corpus/analyze` completes; segments stored in `oaao_corpus_segment`.
- No browser SSE to PHP; polls only.

## Failure cues

| Symptom | Check |
|---------|--------|
| 502 on enqueue | Orchestrator URL, internal token |
| Stuck `learning` | `corpus_job_poll`, vault worker logs |
| Empty segments | Source extract + `OAAO_CORPUS_MARKDOWN_INGEST` |

See [corpus-studio.md](../design/corpus-studio.md) for full API matrix.
