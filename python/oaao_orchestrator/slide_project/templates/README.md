# Slide template catalog (JSON)

Layouts and deck style are **data**, not a growing list of Python `if layout == …` branches.

## Files

| File | Purpose |
|------|---------|
| `catalog.json` | Version + file index |
| `themes.json` | Color palettes (`default`, `executive_problem`, …) |
| `layouts.json` | Per-layout metadata: `component`, recipes, `slots`, LLM prompts |
| `plan.json` | Deck planning: rotation order, title→layout hints, caps |
| `styles.css.tpl` | Shared CSS with `{{bg}}`, `{{accent}}`, … tokens |
| `deck_style.default.json` | Default art-direction object (copied into `deck_style.json` per project) |

## Add a new slide layout (usual case)

1. Pick an existing **`component`** in `layouts.json` (e.g. `three_cards`, `faq_split`).
2. Add a new entry under `"layouts"` with a new id, `content_recipe`, `html_prompt`, optional `title_keywords`.
3. Optionally add the id to `plan.json` → `middle_rotation`.
4. Restart orchestrator (or call `template_registry.reload_templates()` in dev).

No Python change unless you need a **new composition primitive**.

## Per-slot content (Phase 1)

Each layout may declare **`slots`** in `layouts.json` (`id`, `kind`, `recipe`). Deck markdown generation runs **one LLM call per slot**, merges into `content.md`, and saves `slots.json` under `slides/NN/`.

- Disable: `OAAO_SLIDE_SLOT_CONTENT=0` (falls back to one monolithic markdown call per slide).
- Regenerate one slot: `slot_content.regenerate_slot_content(..., slot_id="bullets")`.
- Slide-designer APIs: `POST /slide-designer/api/slide_slots`, `POST /slide-designer/api/slide_regenerate_slot` (chat preview menu uses these).

## PPTX page plan (Phase 2)

On **template analyze**, each PPTX slide becomes a row in **`pages[]`** on the template JSON:

- `layout` — catalog layout id (heuristic + optional LLM `pages[]` in analyze response)
- `slot_seeds` — markdown fragments per layout slot (from profile text)
- `body_hint` — raw text sample for deck generation context

**Thumb** stays `pptx_render` PNG; `preview_pages[]` also carry `layout` + `slot_seeds`.

When a deck uses **`manifest.template_id`**, `phase_outline` / `phase_deck_style` apply `pages[]` to `slides_spec` (`layout_locked`, `slot_seeds`, `template_body_hint`). Phase 1 slot LLM calls use seeds as few-shot input.

## PPTX locale + typography (import analyze)

On **template analyze** (and PPTX re-render enrich), `pptx_typography` adds to `profile`:

- **`locale`** — `primary` (`zh-Hant`, `zh-Hans`, `en`, `ja`, `ko`, `mixed`), `script_mix`, `confidence`, char counts (deterministic from slide text).
- **`fonts`** — `used_typefaces`, theme major/minor, `has_embedded` (detect only; no fntdata extract yet).
- **`typography_hints`** — `recommended_stack`, `line_height_factor`, `avoid_typefaces`, optional `locale_font_mismatch` when CJK text uses Latin-only PPTX fonts.

`deck_style.typography` is **forced** from hints after LLM analyze (LLM cannot set Arial-only for a zh-Hant deck). `pptx_master` HTML uses the stack + CJK line-height/word-break.

Re-import or re-analyze templates to refresh older JSON without these fields.

## PPTX positioned master (Phase 3)

On import (when `OAAO_PPTX_MASTER=1`, default on):

1. **`pptx_geometry`** — each text shape → `geometry_slots[]` with `left_pct` / `top_pct` / `width_pct` / `height_pct` and `slot_id` (from placeholder or heuristic).
2. **`masters/NN.html`** — absolute-position shell under the template asset dir; `pages[].master_path` points to it.
3. Deck slides with **`layout: pptx_master`** render via **`pptx_master.render_pptx_master_slide`** (fills regions from `slot_seeds`, not catalog cards).

Limits: max **8** text regions per slide; tiny boxes filtered out. Groups flattened one level. Tables become a single slot body.

Disable: `OAAO_PPTX_MASTER=0` (falls back to Phase 2 catalog layouts only).

`kind` values: `paragraph`, `bullets`, `section` (### + bullets), `metrics` (3 KPI lines).

## PPTX materials manifest (CP2)

On **template analyze** (and PPTX re-render), when `OAAO_PPTX_MATERIALS=1` (default):

1. Unpack `ppt/media/*` → `{template_id}/materials/media/`
2. Picture shapes → positioned entries in `materials/manifest.json` (`left_pct` / `top_pct` / …)
3. `GET /slide-designer/api/template_material?template_id=&path=materials/media/…` serves files
4. `template_master_html` overlays assets on the slide canvas; on **fidelity PNG** previews only **SVG** (and raster when `OAAO_PPTX_MATERIAL_OVERLAY_RASTER=1`) to avoid duplicating LibreOffice PNG photos.

Re-import a template after upgrading orchestrator to populate materials for existing decks.

## PPTX fonts (CP2 — shared Docker cache)

Google Slides / Office exports often **name** fonts without embedding (`has_embedded: false`). On analyze:

1. Resolve each `profile.fonts.used_typefaces` entry → download from Google Fonts git (Anton, Plus Jakarta Sans, …) or map Calibri → **Carlito** (apt).
2. Store under **`/var/oaao/font-cache`** (bind-mount `OAAO_FONT_CACHE_PATH`) and copy into `{template}/materials/fonts/`.
3. LibreOffice render uses **`FONTCONFIG_FILE`** so PNG previews match.
4. Editor / master HTML get **`@font-face`** via `GET /slide-designer/api/template_font` and `materials/fonts/manifest.json`.

Re-import after `docker compose build orchestrator` to refresh PNGs with correct fonts.

## Micro skills registry (multi-source)

Skills are not only on PPTX files — modules register **providers** via PHP `micro_skill_provider.register` (see `MicroSkillsRegister`).

| Kind | Bind | Storage |
|------|------|---------|
| `bound_template` | **Required** `template_id` | Template JSON `micro_skills` (import LLM) |
| `conversation` | optional workspace | Adjunct `oaao_micro_skill` (user save after preview) |

**Chat flow:** `POST /chat/api/skills_discover` → orchestrator `POST /v1/skills/discover` — LLM matches catalog or returns `suggest_new.preview_markdown` for the user to save via `POST /chat/api/skills_save`.

**Run flow:** `send.php` passes `skills_catalog`; planner may set `apply_skill_ids` / `suggest_skill` in its JSON plan.

## Template micro skills (bound)

Each published PPTX template may include **`micro_skills`** in its JSON manifest (written at **template analyze** by the LLM, or a follow-up pass if omitted).

Agents use micro skills when placing **user material** (outline, vault excerpts, conversation materials) onto masters:

- **`pages[]`**: per master index — `layout_role`, `use_when`, typography/color notes
- **`typography` / `colors`**: font stack rules and palette pairing (not hardcoded keyword lists)
- **`material_rules`**: how to map bullets, paragraphs, metrics into `geometry_slots`

At deck build time the orchestrator calls the LLM with micro skills to pick **`template_page_index`** per outline slide (`plan_template_page_picks`), then injects the block into per-slot content generation.

Disable runtime LLM layout pick: `OAAO_TEMPLATE_MICRO_SKILLS=0` (stored skills still appear in slot prompts).

Re-import templates after upgrading orchestrator to generate `micro_skills` for existing assets.

## New composition primitive (rare)

1. Implement one renderer in `layouts.py` → `_render_component("your_id", …)`.
2. Register `"component": "your_id"` in `layouts.json`.
3. Add any CSS classes to `styles.css.tpl`.

## Per-project style

Runtime LLM output is stored as:

- `deck_style.json` — locked palette + principles for one deck
- `project.json` → `slides_spec[].layout` — layout id from catalog
- `manifest.template_catalog` — catalog version snapshot
- `manifest.template_id` — optional imported template id (skips LLM style pass)

## Import template from PPTX

1. UI uploads `.pptx` → `POST /slide-designer/api/template_analyze` (multipart field `pptx`).
2. PHP saves file under `data/slide-templates/custom/incoming/` (Razy distributor `data/`, same as chat attachments).
3. Orchestrator `POST /v1/slides/template_analyze` extracts structure (`python-pptx`) and calls LLM.
4. Result saved as `data/slide-templates/custom/{scope}/…/{template_id}.json` (`theme` + `deck_style` + `pages[]`, `status: draft`).
5. By default, orchestrator renders **PPTX slide PNGs** under `{template_id}/render/01.png` (LibreOffice); legacy layout HTML may exist under `{template_id}/preview/`.
6. Preview HTML: `GET /slide-designer/api/template_preview_html?template_id=&page=`.
7. If layout validation fails: `POST /slide-designer/api/template_fix` (optional `slide_index`; omit to fix all unverified).
8. When all previews verify: `POST /slide-designer/api/template_publish` → `status: published`.
9. New decks set `template_id` in project manifest → `phase_deck_style` loads preset instead of re-inventing colors.

| Step | API |
|------|-----|
| Analyze + preview | `POST /slide-designer/api/template_analyze` |
| Regenerate preview | `POST /slide-designer/api/template_preview` |
| Fix layout (LLM) | `POST /slide-designer/api/template_fix` |
| Publish | `POST /slide-designer/api/template_publish` |
| List (gallery) | `GET /slide-designer/api/template_list?published_only=1` |

Composer toolbar: **Import slide template** (`cp.slide_designer.template_import`).

### Template scopes (global / tenant / personal)

| Scope | Storage | Who can import | Who sees published |
|-------|---------|----------------|-------------------|
| **global** | `custom/global/` | Platform operator (`platform_admin` on platform host) | Everyone |
| **tenant** | `custom/tenant/{tenant_id}/` | Any user in the tenant | Same tenant |
| **personal** | `custom/personal/{user_id}/` | Owner only | Owner only |

Import: `POST template_analyze` with multipart field **`scope`** = `global` | `tenant` | `personal` (default `personal`).

List merges visible scopes for the caller; filter with `scope_filter`. Response includes `scope_capabilities` for the import UI.

Legacy flat `custom/*.json` files remain readable until migrated.

### Template lifecycle

`draft` → `preview` → `published` (all preview slides verified).

### Nano banana / reference images (planned)

Same pipeline with `source: "image_moodboard"` — vision model extracts palette + layout density from 1–3 PNGs, then writes the same JSON shape. Not wired yet; use PPTX for structured text/layout hints today.
