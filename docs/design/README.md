# Content Studio — Design packs

> **Policy:** Complex epics need a frozen design pack (scope, tasks, KPI) before implementation.  
> **Product backlog:** [OAAO_Content_Studio_Epics.md](../OAAO_Content_Studio_Epics.md) · Jira CSV: [OAAO_Content_Studio_Jira_Import.csv](../OAAO_Content_Studio_Jira_Import.csv)  
> **Deferred (pre-GTM):** Redis canary, Vault ingest SSE phase 2, load-test go/no-go, dead-code retirement — see each pack §Out of scope.

## Chat modular architecture (platform — read first)

| Doc | Purpose |
|-----|---------|
| [**chat-modular-architecture.md**](./chat-modular-architecture.md) | **Hub** — 模組化目的, PHP/Python/UI roles, dual pipelines |
| [**razy-closure-api-bind.md**](./razy-closure-api-bind.md) | **`addAPICommand` / `#` / `bind`** — closure handlers, schema ensure, `$this` in API files |
| [razy-module-autoload.md](./razy-module-autoload.md) | Library autoload, cross-module `require` rules |
| [sprint-module-boundary-charter.md](./sprint-module-boundary-charter.md) | Boundary rules, module matrix, P0–P4 backlog |
| [chat-send-pipeline.md](./chat-send-pipeline.md) | PHP `chat.send.*` phases + orchestrator stream |
| [chat-ui-areas.md](./chat-ui-areas.md) | Six UI areas, `data-oaao-chat-area`, `ui_stage` SSE |
| [module-hooks-registry.md](./module-hooks-registry.md) | Boot registries + per-module inventory |
| [productivity-agents.md](./productivity-agents.md) | Calendar / Todo three-layer hooks |
| [strip-chip-shell.md](./strip-chip-shell.md) | Unified `[strip]` hard shell + `strip_hash` API |
| [run-footprint-contract.md](./run-footprint-contract.md) | `run_principal` token + Python→PHP permission audit |

---

## Feature packs

| Pack | Status | Sprint | Stories |
|------|--------|--------|---------|
| [user-invitation.md](./user-invitation.md) | **implemented** | CS-W1–W3 | PLAT-2-S1…S7 ✅ · Settings invite UI |
| [corpus-studio.md](./corpus-studio.md) | **implemented (core)** | CS-W1–W4 | CS-1-S1…S18 ✅ · S11 tests |
| [library-editor.md](./library-editor.md) | **in progress** | CS-W3–W7 | BlockEditor + convert + `@library` · `test_library_attach_contract.py` |
| [productivity-agents.md](./productivity-agents.md) | **in progress** | CS-W7–W10 | CS-5/CS-6 chips + APIs + i18n · E2E tests stub |
| office-agent.md | *planned* | CS-W6–W9 | CS-3 |
| conversation-skills.md | *planned* | CS-W4–W8 | CS-4 |
| platform-release-notes.md | **implemented (core)** | CS-W11–W12 | PLAT-1-S1…S10 · [runbook](../ops/release-notes-publish-runbook.md) · [seed](../release-notes/README.md) |
| [personalization-tag-mapping.md](./personalization-tag-mapping.md) | **implemented (core)** | CS-W5–W12 | UX-1-S4…S10 · S12 PHP tests · [chat-inference-auto-tune.md](./chat-inference-auto-tune.md) |
| [erp-business-workspace.md](./erp-business-workspace.md) | **v1.0 — frozen (design)** | **BIZ-W1+** · Milestone **Business-ERP-2027** | EPIC-BIZ-1…6（**OAAO 最終龐大產品線**） |
| [workflow-decider-studio.md](./workflow-decider-studio.md) | **v0.1 — draft (types frozen)** | **WF-W1+** · Milestone **Workflow-Decider-2027** | EPIC-WF-1（設計）；EPIC-WF-2 執行（規劃） |

**Sign-off:** Change pack `Status` to `v1.0 — frozen` after cto + php-lead review (one PR comment or standup note).
