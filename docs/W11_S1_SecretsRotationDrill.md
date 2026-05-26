# W11-S1 — Secrets Manager Integration & Rotation Drill

**Status:** ✅ Pointer schemes wired in [_internal_secret.py](../python/oaao_orchestrator/_internal_secret.py). Drill procedure below is the operational complement.

## 1. Resolved secrets surface

`OAAO_ORCH_SHARED_SECRET` is the canonical orchestrator/PHP shared HMAC. Accepted values:

| Form | Example | Notes |
| --- | --- | --- |
| Plain | `abc123...` | Dev only |
| Env indirection | `env:SECRET_INNER` | Single hop; resolves at load |
| File | `file:/run/secrets/oaao_orch` | Docker/K8s secret mount |
| AWS Secrets Manager | `aws-sm:us-east-1/oaao/orch#secret` | Hook stub — wire `boto3` per deployment |
| HashiCorp Vault | `vault:oaao/orch#secret` | Hook stub — wire `hvac` per deployment |

The accessor caches via `lru_cache(maxsize=1)`. A rotation requires `_cached_secret.cache_clear()` **and** a process restart to ensure all subprocesses pick up the new value.

## 2. Rotation drill (production)

> **Goal:** rotate `OAAO_ORCH_SHARED_SECRET` with zero failed `/v1/*` calls.

### Pre-flight
1. Confirm both Python orchestrator and PHP Razy backbone read the secret from the **same** scheme (e.g. both `file:/run/secrets/oaao_orch`).
2. Verify the PHP side mirrors the value via `OaaoErrorCode::INTERNAL_SECRET_MISSING` parity test.
3. Snapshot KPI baselines: 5xx rate, queue depth, p95 latency.

### Drill steps
1. **Mint new value** into the secrets store under the *new* key (do not overwrite yet).
2. **Stage two-secret mode**: set `OAAO_ORCH_SHARED_SECRET_NEXT` (file: or env:) to the new value while the live secret remains unchanged. Hot-reload nothing yet.
3. **Roll PHP first** — deploy a build that accepts EITHER current OR `_NEXT` for inbound `X-OAAO-Internal-Token`. Watch logs for `bad_internal_token` events for 10 minutes; should remain near baseline.
4. **Promote** — swap `OAAO_ORCH_SHARED_SECRET` to the new value on every orchestrator replica via rolling restart (3–5 min intervals).
5. **Demote** — remove `_NEXT` acceptance from PHP after 1 hour stabilisation.
6. **Audit** — invalidate the old secret in the store; verify no `bad_internal_token` events in the past 30 minutes.

### Rollback
- If `bad_internal_token` rate exceeds 0.1% in any 1-minute window during Step 4:
  1. Revert the orchestrator deployment (previous tag) — PHP still accepts both.
  2. Investigate consumer disparity (sidecars, CRON tasks).
  3. Re-run from Step 1 after fix.

## 3. Provider hook implementation note

`aws-sm:` and `vault:` raise `InternalSecretProviderError` by design. To wire:

```python
# Inside _resolve_pointer():
if value.startswith(_SCHEME_AWS_SM):
    import boto3
    client = boto3.client("secretsmanager")
    secret_id = value[len(_SCHEME_AWS_SM):].split("#", 1)[0]
    field = value.split("#", 1)[1] if "#" in value else "SecretString"
    resp = client.get_secret_value(SecretId=secret_id)
    return resp[field].strip()
```

Tests for the hook must mock `boto3.client` — see `tests/test_internal_secret.py` for the env/file paths.

## 4. Drill cadence

- **Quarterly** in staging.
- **Annually** in production (calendar event owned by SRE).
- **Out-of-band** on suspected leak (rotate + audit logs within 24h).
