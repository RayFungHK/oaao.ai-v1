# W3-S3 — Dead Code Marking & Retirement List (v1)

**Status:** v1 inventory. **Action:** No deletions yet — this document is the
candidate set. Retirement happens in W6+ once owners confirm and CI gates are
in place for re-introduction prevention.

## Scope rules

- Only items belonging to or shadowing `oaao.ai-v1/` are listed. Other
  workspace projects (Razy, RazyUI, tagoo) are out of scope per
  `oaao-scope-rules.md`.
- "Dead" means one of:
  - **D1** — file/dir is a parallel/legacy mirror of a maintained path.
  - **D2** — symbol is unreferenced after grep across `oaao.ai-v1/` +
    `oaao-hub/` (excluding tests of the symbol itself).
  - **D3** — branch reachable only under a feature flag that has been
    permanently `False` for ≥ 2 sprints.
  - **D4** — replaced by a refactor; old path kept only for backwards-compat
    that no caller relies on.
- Risk grades: **L** (no observed runtime referent), **M** (referenced only
  by tests or by docs/examples), **H** (referenced by live code paths but
  appears unreachable).

## Inventory

| # | Path / Symbol | Type | Reason | Risk | Retire-by sprint |
|---|---------------|------|--------|------|------------------|
| 1 | `archived/oaao-hub/` | dir | D1 — superseded by `oaao-hub/` and `oaao.ai-v1/`. Already named "archived". | L | W6 |
| 2 | `oaao.ai-v1-temp/` | dir | D1 — temp snapshot from a prior migration; `oaao.ai-v1/` is canonical. | L | W6 |
| 3 | `oaao-hub/docker/` legacy gateway | dir | D1 — relay moved to `CIT-CMT-gateway/`. | M | W7 |
| 4 | `development-razy0.4/` | dir | D1 — legacy Razy 0.4 instance, replaced by `Razy-Dev/`. | L (project), M (history) | W8 (after final audit hand-off) |
| 5 | `Razy/invalid` | file | D2 — placeholder file, zero references. | L | W6 |
| 6 | `oaao.ai-v1/python/oaao_orchestrator/app.py::_shared_secret` | symbol | D4 — wrapper around `require_internal_secret()` after W11-S1 + W5-S1. Most callers have moved to `routes/_deps.require_internal_token`. | M | W7 (after remaining inline `/v1/*` routes migrate in W5-S1 phase 2) |
| 7 | `oaao.ai-v1/cookies.txt` | file | D2 — captured dev cookie jar, never imported by any script. | L | W6 |
| 8 | `oaao.ai-v1/login.json`, `oaao.ai-v1/tempbody.json`, `oaao.ai-v1/debug-out.txt`, `oaao.ai-v1/check.txt`, `oaao.ai-v1/temp_apache.txt`, `oaao.ai-v1/api-check.txt` | files | D2 — scratch artifacts left in workspace root. | L | W6 |
| 9 | `oaao.ai-v1/audit_acc_modules_report.txt`, `oaao.ai-v1/audit_acc_modules.json` | files | D4 — superseded by `docs/Audit_Report.md` + per-sprint KPI snapshots. | M (historical) | W7 (move to `docs/archive/`) |
| 10 | `oaao.ai-v1/list_orm.php`, `oaao.ai-v1/debug.php` | files | D2 — ad-hoc debug shims; no entry point references them. | M (manual debug aid) | W7 (move to `scripts/dev/`) |
| 11 | `oaao.ai-v1/compare-razyui-v2.ps1`, `oaao.ai-v1/compare-razyui.ps1`, `oaao.ai-v1/recover-razyui.ps1`, `oaao.ai-v1/recover-docs*.ps1`, `oaao.ai-v1/list-docs-history.ps1`, `oaao.ai-v1/extract-sourcemaps.ps1`, `oaao.ai-v1/final_check.ps1` | files | D2 — one-shot recovery/inspection scripts from earlier migrations. | M (institutional memory) | W8 (move to `scripts/oneoffs/`) |
| 12 | `oaao.ai-v1/convert-jit.py` | file | D2 — one-shot JIT migration helper; RazyUI/ now owns the canonical converter. | L | W6 |
| 13 | `oaao.ai-v1/python/oaao_orchestrator/run_executor.py` upstream-sampling underscore aliases | symbols | D4 — `_resolve_max_tokens`, `_apply_upstream_sampling`, `_llm_stream_timeout` are now thin re-exports of `run_executor_upstream`. Aliases retained for diff-noise reduction in W5-S2 phase 1; can drop in phase 2 after callers move to direct imports. | L | W5-S2 phase 2 |
| 14 | `oaao.ai-v1/research-3d-cross-attention.md`, `oaao.ai-v1/research-cross2d/`, `oaao.ai-v1/research-distill/` | files/dirs | D2 — R&D scratch areas; no references from product code or active docs. | M (research value) | W8 (move to `oaaoai_asset/research/`) |
| 15 | `oaao.ai-v1/Volsphere/`, `oaao.ai-v1/parapixel/`, `oaao.ai-v1/sample-layout/`, `oaao.ai-v1/web-design/` | dirs | D1 — sibling exploratory projects not part of orchestrator/backbone shipping path. | L | W9 (confirm with owners; move out of `oaao.ai-v1/` root) |
| 16 | `oaao.ai-v1/project/`, `oaao.ai-v1/reference/` | dirs | D2 — unclear ownership; appear empty or near-empty at v1 baseline. | L | W6 (confirm + delete or move) |
| 17 | `oaao.ai-v1/docker-compose.yaml` (root) vs `oaao.ai-v1/oaao.ai-v1/docker-compose.yml` (project) | file | D1 — workspace-root compose shadows project-level one; only one is loaded by `scripts/run.ps1`. | M | W7 (consolidate; document canonical path) |
| 18 | Inline `secrets.compare_digest(...)` guards in `app.py` for `/v1/slides/*`, `/v1/research/*`, `/v1/mine/*`, `/v1/live/*` | symbols | D4 — duplicated auth pattern; should adopt `Depends(require_internal_token)` from `routes/_deps.py` in W5-S1 phase 2. | M | W5-S1 phase 2 |
| 19 | `oaaoai_asset/relay/` (if no live import) | dir | D2 — superseded by `CIT-CMT-gateway/`. | M | W8 (confirm with relay owner) |
| 20 | Top-level `*.ps1` and `*.py` analysis helpers in `development-razy0.4/` (`analyze_keys.ps1`, `analyze_lang_keys.py`, `add_menu.py`, `fix_zh_lang.py`, `update_zh_lang.py`, `check_missing_lang_keys.php`, `update_menu.ps1`) | files | D2 — one-shot localisation tooling; runs not part of any CI. | M | W8 (move to `development-razy0.4/scripts/oneoffs/` if dir retained, else delete with item #4) |

## Cross-links

- Discovery method (sweep): `Get-ChildItem -Recurse -File`, `ruff check --select F401,F841`, ad-hoc `grep_search` for each symbol across `oaao.ai-v1/`, `oaao-hub/`, `Razy/`, `Razy-Dev/`.
- Owners: each row should gain an owner column in v2 (W6). Until then, default owner is the orchestrator lead.
- Retirement gate: deletion PR must be paired with a CI check that prevents
  re-introduction (e.g. `scripts/check_retired_paths.sh`) — to be added with
  the first batch of W6 deletions.

## Not yet inventoried (deferred to v2)

- Unused exports inside `oaao_orchestrator/streaming/` (FFT of imports too
  broad to grep cheaply this sprint).
- Backbone PHP unreferenced helper functions (needs phpstan dead-code rules
  enabled — tracked under W9).
- Test fixtures duplicated across `tests/` and `Test_Suite/` (need a
  cross-suite name diff before listing).
