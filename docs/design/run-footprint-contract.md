# Run footprint contract (P4)

Signed **`run_principal`** token issued at chat send; Python validates it for the whole orchestrator run and attaches it to internal PHP calls that read or mutate conversation data.

## Token schema

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | int | Must match request `user_id` |
| `conversation_id` | int | Must match request `conversation_id` |
| `assistant_message_id` | int | Row created for this assistant turn |
| `workspace_id` | int? | Optional scope |
| `tenant_id` | int? | Optional scope |
| `exp` | int | Unix expiry (default TTL 7200s) |

Implementation: `python/oaao_orchestrator/run_principal.py` (`issue_token`, `verify_token`, `require_for_request`).

PHP issues the token during send bootstrap; orchestrator ingress carries it as `run_principal` on `ChatRunRequest`.

## Required usage

Any Python → PHP internal call that **reads or writes** user-owned chat data for the active turn MUST:

1. Accept `RunPrincipal` (or re-issue from an existing principal via `issue_token`).
2. Pass `run_principal` in the JSON body to PHP internal endpoints.
3. Include the shared internal secret (`OAAO_INTERNAL_SECRET` / `require_internal_secret()`).

### Calls that MUST carry `run_principal`

| Caller | PHP target | Status |
|--------|------------|--------|
| `chat_persist.persist_assistant_message` | SQLite adjunct (principal-validated SQL) | **Compliant** |
| `chat_internal_sync.sync_adjunct_via_php` | `/chat/api/assistant_internal_sync` | **Compliant** — PHP verifies token |
| `post_turn_action_worker` meta attach | `persist_assistant_message` | **Compliant** |
| `micro_skills.usage_sync.record_skill_usage_via_php` | `/chat/api/skills_usage_record` | **Compliant** — PHP verifies token |

### Evolution plane (internal secret + optional `run_principal`)

| Caller | PHP target | Status |
|--------|------------|--------|
| `post_stream_persist.upsert_turn_score` | `/chat/api/turn_score_upsert` | **Hardened** — forwards `run_principal`; PHP `ChatInternalPrincipalGate` validates when present |
| `post_stream_persist.apply_inference_turn` | `/chat/api/inference_turn_apply` | **Hardened** — same gate |

### By design (no `run_principal`)

| Caller | Auth | Notes |
|--------|------|-------|
| `chat_helpers._report_usage_to_php` | Internal secret | Tenant metering — not turn-scoped |
| Orchestrator `/v1/*` routes | `require_internal_token` | Sidecar ingress; not user chat rows |
| `knowledge/vault_client` upload | Internal headers | Asset promotion plane |

## Validation rules (`RunPrincipal.matches_request`)

On each use, Python verifies the token fields still match the live request payload (`user_id`, `conversation_id`, `assistant_message_id`, optional workspace/tenant). Mismatch → log warning and reject.

## UI / worker data reads

Background workers (post-stream IQS/ACCS, post-turn productivity) MUST NOT bypass PHP permission checks when fetching conversation rows. Today:

- **Scores:** written via evolution post-stream pool (plugin context from run meta).
- **Productivity chips:** attached via `persist_assistant_message` with validated principal.
- **Client hydrate:** reads public chat API scoped to session user — no footprint on browser polls; canonical path is **`ui_stage`** SSE (info/state/strip) while stream session is open.

## Checklist for new internal calls

- [ ] Principal issued or forwarded from `require_for_request(req)`
- [ ] Token included in POST body as `run_principal`
- [ ] Internal secret header/body field set
- [ ] PHP handler validates principal + user permission before SQL
- [ ] No ad-hoc `user_id` / `conversation_id` trust from unauthenticated body fields

## Related docs

- [chat-send-pipeline.md](./chat-send-pipeline.md) — send bootstrap and orchestrator payload
- [chat-modular-architecture.md](./chat-modular-architecture.md) — `ui_stage` info/state/strip areas
- [sprint-module-boundary-charter.md](./sprint-module-boundary-charter.md) — P4 backlog
