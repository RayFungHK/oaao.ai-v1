# Backlog — Library block editor (CS-2-S4+)

**Shipped (T3):** icon rail `workspace/library`, split sidebar list, minimal contenteditable blocks, autosave, **Import text** → `library_document_convert` (orchestrator stub + PG persist).

## Gaps (defer post-UAT unless prioritized)

| ID | Item | Epic |
|----|------|------|
| L-ED-1 | RazyUI Block Editor component (not raw `contenteditable`) | CS-2-S4 |
| L-ED-2 | Block types: bullet/numbered lists, code, table, divider | CS-2-S4 |
| L-ED-3 | `library_revision_commit` optimistic locking (`base_revision_id`) | CS-2-S2 |
| L-ED-4 | Upload file → full `POST /v1/library/convert` (docx/pdf, not text stub) | CS-2-S3 |
| L-ED-5 | `POST /v1/library/ai/transform` selection actions | CS-2-S5 |
| L-ED-6 | Qdrant embed + `library_documents_search` / chat `@library` | CS-2-S7–S10 |
| L-ED-7 | `library_finalize_to_vault` | CS-2-S9 |
| L-ED-8 | Import text → RazyUI `Dialog` + `AjaxForm` (replace `window.prompt`) | UX |

**Design:** [library-editor.md](../../../../docs/design/library-editor.md)
