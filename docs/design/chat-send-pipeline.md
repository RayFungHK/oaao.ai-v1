# Chat send pipeline (PHP)

Thin orchestration for `POST /chat/api/send` — replace inline cross-module logic in `send.php` with **chainable Razy hook phases**.

**Related:** [Audit_Report.md](../Audit_Report.md) §6 (cross-module coupling) · [razy-module-autoload.md](./razy-module-autoload.md) · [bubble-chat.md](./bubble-chat.md)

---

## 1. Problem

`chat/default/controller/api/send.php` (~1400 lines) owns vault parsing, slide-designer extras, endpoints binding, conversation persistence, and orchestrator payload assembly. That violates the productization rule:

> Multi-module pipeline steps must be **hook points** owned by each module — not hardcoded in a single controller.

Repeated AI edits to `send.php` reintroduce cross-module bugs because there is no stable extension surface.

---

## 2. Target shape

```
send.php (thin)
  → ChatSendContext (per-request mutable state)
  → ChatSendPipeline::run(phase, ctx)
       → $this->trigger('chat.send.{phase}')->resolve(['context' => $ctx])
            ← oaaoai/chat listeners (core)
            ← oaaoai/vault listeners (vault scope)
            ← oaaoai/slide-designer, oaaoai/endpoints, … (future)
  → read ctx fields → persist / POST orchestrator → JSON response
```

Compare with existing **registry** pattern (`planner_agent.register`, `chat_pipeline.register`): those answer *what exists at boot*. Chat send hooks answer *what happens on each POST*.

---

## 3. Phases

| Phase | Event | Owner (today) | Notes |
|--------|--------|---------------|--------|
| `gate` | `chat.send.gate` | chat (stub) | Credits, workspace scope — still inline in `send.php` |
| **`prepare`** | **`chat.send.prepare`** | **chat + vault + slide-designer** | **Shipped:** composer flags, vault refs, attachments, slide template |
| **`scope`** | **`chat.send.scope`** | **chat** | **Shipped:** auto-RAG / teaching-intent vault expansion |
| `persist` | `chat.send.persist` | chat | Adjunct SQLite TX — chat-only tables |
| **`conversation_settle`** | **`chat.send.conversation_settle`** | **chat + slide-designer** | **Shipped:** provisional title, inference meta, user message meta |
| **`orchestrator_ready`** | **`chat.send.orchestrator_ready`** | **chat + endpoints + vault + slide-designer** | **Partial:** `bind`, `agents`, `slide`, `payload` stages |
| `run_start` | `chat.send.run_start` | chat | POST `/v1/runs/chat`, stream URL |
| `respond` | `chat.send.respond` | chat | JSON envelope to browser |

Phases run in order when using `ChatSendPipeline::runMany()`. Migration is **incremental** — wire one phase at a time in `send.php`.

---

## 4. Core types (chat module)

| Class | Role |
|--------|------|
| `ChatSendPhase` | Phase name constants + `eventName()` |
| `ChatSendContext` | Request state; modules mutate fields or `moduleData('vault')` |
| `ChatSendPipeline` | Fires `chat.send.*` on `oaaoai/chat` |
| `ChatSendAbort` | Early JSON exit (HTTP status + payload) |
| `ChatSendComposer` | Chat-owned input parsing (web search, attachments) |

**Hard rule (new work):** do not add cross-module parsing or `require_once` of another module's library in `send.php`. Register a listener instead.

---

## 5. Module extension template (vault — reference)

### 5.1 Library — domain parsing

`vault/default/library/VaultSendScope.php` — `parseComposerInput()`, `parseAutoRag()`.

### 5.2 Event listener

`vault/default/controller/event/chat_send_prepare.php`:

```php
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (!$ctx instanceof \oaaoai\chat\ChatSendContext) {
        return;
    }
    $parsed = VaultSendScope::parseComposerInput($ctx->input);
    $ctx->vaultSourceRefs = $parsed['refs'];
    $ctx->vaultSourceIds = $parsed['ids'];
    $ctx->vaultAutoRag = $parsed['auto_rag'];
};
```

### 5.3 Register in `__onInit`

```php
$agent->listen('oaaoai/chat:chat.send.prepare', 'event/chat_send_prepare');
```

No changes to `send.php` when adding vault-only behavior — only the listener.

---

## 6. Migration backlog (priority)

1. **Done:** `prepare` — vault scope, web search, attachments, slide template.
2. **Done:** `scope` — vault auto-expand after message content known.
3. **Partial:** `orchestrator_ready` — bind + agents + endpoints/vault payload (slide/materials still in `send.php`).
4. **Done:** `conversation_settle` — title, inference snapshot, user meta (+ slide-designer template meta).
5. **Next:** `gate` — credit block, workspace gate.
6. **Partial:** `orchestrator_ready` — slide `SLIDE` stage shipped; skills_catalog / personalization still in `send.php`.
7. **Next:** `gate` — credit block, workspace gate.

Modules to migrate (non-exhaustive):

| Module | Target phase(s) | Today in `send.php` |
|--------|-----------------|---------------------|
| vault | prepare, orchestrator_ready | refs, auto-RAG, profiles, glossary via API |
| endpoints | orchestrator_ready | purpose binding, allowed agents, UIQE |
| slide-designer | prepare?, orchestrator_ready | template id, material container |
| corpus | orchestrator_ready | `corpus_id` style injection |
| live-meeting | orchestrator_ready | ASR extras (via chat API today) |

---

## 7. Bubble vs full chat

Same pipeline and phases. `ChatSendContext::$isBubbleChat` is set from `input.bubble`. Listeners that should skip persistent-agent behavior check this flag (or downstream Python `conversation_kind: bubble` — unchanged).

---

## 8. Testing

- PHP: `chat/default/tests/ChatSendPrepareTest.php`, `vault/default/tests/VaultSendScopeTest.php`
- Python contract: extend `test_orchestrator_bridge_contract.py` to assert pipeline classes exist
- Manual: send with vault refs + `enable_web_search` + attachments — payload unchanged vs pre-refactor

---

## 9. AGENTS.md snippet (recommended)

When editing chat send behavior:

1. Prefer a `chat.send.{phase}` listener in the **owning module**.
2. Never `require_once` another module's library from `send.php`.
3. Expose cross-module data via `$this->api('module')` or listener mutation of `ChatSendContext`.
4. Keep `send.php` as wiring only — if a change needs >10 lines of domain logic, it belongs in a hook.
