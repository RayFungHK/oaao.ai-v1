# Razy closure API, `#` prefix, and internal bind

How oaao.ai modules register **closure handlers** for cross-module calls and for **`$this->method()` inside bound closures**.

**Related:** [razy-module-autoload.md](./razy-module-autoload.md) · [Audit_Report.md](../Audit_Report.md) §6 · Razy `documentation/pages/agent.html` (`bind`, `addAPICommand`)

**Requires:** Razy **v1.0.3-beta+** (`Agent::bind()`, `Controller::__call()` bind registry).

---

## 1. Three registration modes

Razy separates **published Module API** from **internal controller method bridge**.

| Registration | `api('auth')->ensureX($pdo)` | `$this->ensureX($pdo)` in closure | Typical use |
|--------------|------------------------------|-----------------------------------|-------------|
| `addAPICommand('ensureX', 'api/ensure_x')` | ✅ | ❌ | Cross-module only |
| `addAPICommand('#ensureX', 'api/ensure_x')` | ✅ | ✅ | **Default for schema ensure** — API + internal |
| `$agent->bind('ensureX', 'api/ensure_x')` | ❌ | ✅ | Internal helper only — not exposed to other modules |

Implementation (Razy `CommandRegistry::addAPICommand`):

- Commands prefixed with **`#`** are stored in the API registry **and** registered on `ClosureLoader::bind()`.
- `$agent->bind()` is equivalent to the bind half only (see Razy `Agent::bind()`).

**Do not** duplicate `addAPICommand` + `bind()` for the same method when `#` suffices.

---

## 2. Resolution paths

### Cross-module: `$this->api('auth')->ensureCalendarSchema($pdo)`

```
Emitter::__call
  → CommandRegistry::execute(apiCommands)
  → load closure from path, bindTo(controller), invoke
```

### Internal: `$this->ensureCalendarSchema($pdo)` inside `controller/api/*.php`

```
Controller::__call
  → Module::getBinding(method)   // from # prefix or explicit bind()
  → Module::getClosure(path)     // bound to controller
  → invoke
```

If neither binding nor `{ClassName}.{method}.php` exists → **`BadMethodCallException`**:  
`The method 'ensureX' is not defined in 'Razy\Controller@anonymous'`.

---

## 3. oaao.ai pattern: closure file + `#` command

### 3.1 Closure file

```php
// auth/default/controller/api/ensure_calendar_schema.php
<?php

declare(strict_types=1);

return function (\PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_calendar_event ( … )');
};
```

### 3.2 Register in `__onInit`

**Auth** — many schema commands; prefix in a loop:

```php
$schemaDualCommands = [
    'ensureCalendarSchema' => 'api/ensure_calendar_schema',
    'ensureTenantSchema'   => 'api/ensure_tenant_schema',
    // …
];
$prefixedSchemaCommands = [];
foreach ($schemaDualCommands as $name => $path) {
    $prefixedSchemaCommands['#' . $name] = $path;
}

$agent->addAPICommand([
    'getUser' => 'getUser',
    // … non-closure API …
] + $prefixedSchemaCommands);
```

**Chat / slide-designer** — inline `#` is fine for a small set:

```php
$agent->addAPICommand([
    '#ensureConversationAttachmentSchema' => 'api/ensure_conversation_attachment_schema',
    '#ensureMicroSkillSchema'             => 'api/ensure_micro_skill_schema',
    'getChatPipelineRegistry'             => 'getChatPipelineRegistry',
]);
```

### 3.3 Nested closure calls (same module)

Inside a bound closure, call sibling ensures via **`$this`** (requires `#` or `bind`):

```php
// auth/default/controller/api/ensure_tenant_schema.php
return function (\PDO $pdo): void {
    // … tenant DDL …
    $this->ensureCreditSchema($pdo);
    $this->ensureStorageSchema($pdo);
};
```

### 3.4 Cross-module caller

**Never** `require_once` auth `controller/api/_ensure_*`. Call published API:

```php
// calendar/…/event/chat_send_orchestrator_ready.php
$this->api('auth')->ensureCalendarSchema($canonPdo);
```

Declare dependency in `package.php` `require` if needed.

---

## 4. Schema ownership (oaao.ai)

| Owner module | Examples | Register with |
|--------------|----------|---------------|
| **auth** | `ensureTenantSchema`, `ensureCreditSchema`, `ensureCalendarSchema`, `ensurePgCoreTables` | `#ensure*` in `auth.php` |
| **chat** | `ensureConversationAttachmentSchema`, `ensureMicroSkillSchema` | `#ensure*` in `chat.php` |
| **slide-designer** | `ensureSlideProjectSchema` | `#ensureSlideProjectSchema` in `slide-designer.php` |

Auth boot (`ensure_pg_core_tables.php`) chains `$this->ensurePgExtensionSchemas()`, `$this->ensureTenantSchema()`, etc. — all must be `#`-registered on auth.

---

## 5. Anti-patterns (do not reintroduce)

| Anti-pattern | Why wrong | Fix |
|--------------|-----------|-----|
| `_ensure_*_schema.php` procedural shims + `oaao_auth_*()` | Bypasses Razy bind; breaks under namespaced controllers | Delete shims; use `#` + closure file |
| `require_once` peer module `controller/api/_ensure_*` | P0 boundary violation | `$this->api('auth')->ensureX($pdo)` |
| `addAPICommand` only, closure uses `$this->ensureX()` | Internal `__call` has no binding | Add `#` prefix |
| Public PHP method `function ensureX()` that loads shim | Shadows `#` / blocks `__call`; duplicates logic | Remove method; rely on closure + `#` |
| `addAPICommand` + separate `$agent->bind()` for same name | Redundant when `#` does both | Use `#` only |

---

## 6. Checklist — new closure command

1. Add `controller/api/my_handler.php` returning `function (...) { … }`.
2. Decide exposure:
   - Other modules need it → `'#myHandler' => 'api/my_handler'` (or `'myHandler'` if internal never calls `$this->myHandler()`).
   - Internal only → `$agent->bind('myHandler', 'api/my_handler')` without API entry.
3. If closure calls `$this->otherBoundMethod()`, ensure **`#otherBoundMethod`** (or `bind`) is registered in the same module's `__onInit`.
4. Cross-module: `$this->api('module')->method(...)` + `package.php` `require`.
5. **No** `require_once` of another module's controller paths.
6. After Razy upgrade, confirm site runs **v1.0.3-beta+** phar (`Agent::bind` / `#` bind path).

---

## 7. Symptoms → fixes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `The method 'ensureX' is not defined in 'Razy\Controller@anonymous'` | Closure calls `$this->ensureX()` but command registered without `#` / `bind` | `'#ensureX' => 'api/ensure_x'` in `__onInit` |
| `Call to undefined function … oaao_auth_ensure_*()` | Legacy procedural shim removed | Use `api('auth')->ensureX()` or auth `#` + `$this->ensureX()` |
| `api('chat')->ensureX()` returns null / no-op | Command not in `addAPICommand` (bind-only) | Add API registration or use `#` |
| Duplicate bind error on boot | Same method bound twice with different paths | One registration; prefer `#` |

---

## 8. Reference modules (copy from)

| Module | File | Notes |
|--------|------|-------|
| auth | `auth/default/controller/auth.php` | `$schemaDualCommands` + `#` prefix loop |
| chat | `chat/default/controller/chat.php` | `#ensureConversation*` schema set |
| slide-designer | `slide-designer/default/controller/slide-designer.php` | `#ensureSlideProjectSchema` |
| calendar hook | `calendar/…/event/chat_send_orchestrator_ready.php` | `$this->api('auth')->ensureCalendarSchema()` |

---

## 9. Razy upstream docs

- **Agent `bind()`** — `Razy/documentation/pages/agent.html`
- **Cross-module API** — `Razy/documentation/pages/cross-module-api.html`
- **Tests** — `Razy/tests/ClosureBindingTest.php` (`#` dual registration, bind-only not in API registry)
