# Office Generation Agent (CS-3)

| Field | Value |
|-------|--------|
| **Status** | v1 — PDF + DOCX |
| **Agent kind** | `office_generate` |
| **Module registration** | `oaaoai/corpus` → `PlannerAgentRegister` |

## Tool contract (planner JSON)

Planner selects `office_generate` via `RunTaskSpec.params`:

| Param | Values | Notes |
|-------|--------|--------|
| `source` | `corpus_template`, `corpus_brief`, `message` | PDF requires corpus `style_json` for template track |
| `format` | `html`, `pdf`, `docx` | PDF/HTML via `run_corpus_render`; DOCX via `docx_render` |
| `brief` | string | optional override |
| `file_name` | string | download name |
| `material_id` | string | chat artifact id |

## Tracks

1. **PDF / HTML** — delegates to CS-1 `run_corpus_render()` (weasyprint for PDF).
2. **DOCX** — `markdown_to_docx_bytes` / `blocks_to_docx_bytes` from user message or library blocks.

## Artifacts

Emitted on `AgentResult.artifacts` with `id` = `material_id` for Materials UI indexing.

## Dependencies

- `python-docx`, `weasyprint` (optional PDF)
- `AgentMaterialStorage` / `material_storage.py` for conversation persistence
