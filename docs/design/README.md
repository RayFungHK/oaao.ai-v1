# Content Studio — Design packs

> **Policy:** Complex epics need a frozen design pack (scope, tasks, KPI) before implementation.  
> **Product backlog:** [OAAO_Content_Studio_Epics.md](../OAAO_Content_Studio_Epics.md) · Jira CSV: [OAAO_Content_Studio_Jira_Import.csv](../OAAO_Content_Studio_Jira_Import.csv)  
> **Deferred (pre-GTM):** Redis canary, Vault ingest SSE phase 2, load-test go/no-go, dead-code retirement — see each pack §Out of scope.

| Pack | Status | Sprint | Stories |
|------|--------|--------|---------|
| [user-invitation.md](./user-invitation.md) | **implemented** | CS-W1–W3 | PLAT-2-S1…S7 ✅ · Settings invite UI |
| [corpus-studio.md](./corpus-studio.md) | **implemented (core)** | CS-W1–W4 | CS-1-S1…S18 ✅ · S11 tests |
| [library-editor.md](./library-editor.md) | **in progress** | CS-W3–W7 | BlockEditor + convert upload + finalize |
| productivity-agents.md | **in progress** | CS-W7–W10 | CS-5 ✅ · CS-6 header panel started |
| office-agent.md | *planned* | CS-W6–W9 | CS-3 |
| conversation-skills.md | *planned* | CS-W4–W8 | CS-4 |
| platform-release-notes.md | *planned* | CS-W11–W12 | PLAT-1 (S1/S5/S6/S8 shell in repo) · [What's New seed copy](../release-notes/README.md) |
| chat-personalization.md | *planned* | CS-W4–W12 | UX-1 |
| [erp-business-workspace.md](./erp-business-workspace.md) | **v1.0 — frozen (design)** | **BIZ-W1+** · Milestone **Business-ERP-2027** | EPIC-BIZ-1…6（**OAAO 最終龐大產品線**） |
| [workflow-decider-studio.md](./workflow-decider-studio.md) | **v0.1 — draft (types frozen)** | **WF-W1+** · Milestone **Workflow-Decider-2027** | EPIC-WF-1（設計）；EPIC-WF-2 執行（規劃） |

**Sign-off:** Change pack `Status` to `v1.0 — frozen` after cto + php-lead review (one PR comment or standup note).
