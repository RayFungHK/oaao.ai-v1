# OAAO.ai Cross-Tier Contracts (W7-S1)

Versioned JSON Schemas that PHP and Python must both honor on every shared
wire-format. **Adding fields is additive; removing or renaming fields requires
bumping `protocol_version` and shipping both tiers atomically.**

## Layout

```
contracts/
  v1/
    error.json              # W4-S2 canonical error envelope
    chat-run.request.json   # Orchestrator /chat/* + PHP relay payload
    vault-job.envelope.json # PHP /vault/api ↔ orchestrator job exchange
```

## Loading

Python:

```python
from oaao_orchestrator.contracts import load_schema, validate

req_schema = load_schema("chat-run.request")
validate(payload, req_schema)  # raises jsonschema.ValidationError on miss
```

PHP (using `justinrainbow/json-schema` if/when added):

```php
$schema = json_decode(file_get_contents(__DIR__ . '/../../../../../contracts/v1/error.json'));
```

## CI contract gate

The python test suite includes `test_contracts_php_mirror.py` (planned) which:

1. Walks every PHP controller emitting JSON via `\Razy\Result::*` helpers.
2. Validates fixture payloads against `contracts/v1/*.json`.
3. Fails CI if a tier drifts.

Currently the test asserts only that every schema parses and that the cross-tier
error code list in `OaaoErrorCode.php` matches `errors.py` exactly (W4-S2). The
fuller behavioral contract tests are scoped for W7-S2 (queue boundary work).

## Versioning

- `protocol_version: "1"` is current.
- A field marked `additionalProperties: true` may grow; clients MUST tolerate
  unknown fields.
- A field whose enum shrinks or whose `required` set grows is a breaking change.
