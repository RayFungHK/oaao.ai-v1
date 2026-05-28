# Design pack — User Invitation & Self-Registration (EPIC-PLAT-2)

| Field | Value |
|-------|--------|
| **Status** | v1.0 — ready to implement |
| **Epic** | EPIC-PLAT-2 |
| **Milestone** | Platform-2026 |
| **Sprint** | CS-W1 (S1–S3) · CS-W2 (S4–S5) · CS-W3 (S6–S7) |
| **Authoritative spec** | [OAAO_Content_Studio_Epics.md §10](../OAAO_Content_Studio_Epics.md) |

---

## 1. Scope

### In scope

- Admin **Send invitation** (email + optional role / permission group); **no** admin-set password on create.
- Token tables + mail templates (EN/zh).
- Public SPA: `/register?token=` · `/reset-password?token=`.
- Forgot-password request API (enumeration-safe).
- Settings → Users: pending invitations (resend / revoke); create-user entry becomes **Invite**.

### Out of scope (this pack)

- SSO / OAuth ([OpenWebUI_Gap_Analysis.md](../OpenWebUI_Gap_Analysis.md)).
- UX-1 first-login questionnaire (depends on PLAT-2 register complete — [chat-personalization.md](./chat-personalization.md) later).
- Platform operator cross-tenant user provisioning (stay on existing platform flows).

### Pre-GTM (do not block this epic)

- Secrets rotation drill, Redis canary, W13 load test.

---

## 2. Current baseline

| Area | Today | Change |
|------|-------|--------|
| Create user | `POST /user/api/users_save` accepts `password` on insert | New users via invite only; `users_save` insert without invite token **403** (admin may still **edit** existing users) |
| Schema | `oaao_user` in auth installers | Add `oaao_user_invitation`, `oaao_password_reset` (or unified token table with `kind`) |
| Mail | SMTP configurable in tenant/platform settings | Reuse existing mail enqueue pattern (grep `mail` in `oaaoai/user`, `oaaoai/platform`) |

---

## 3. Data model (v1)

### `oaao_user_invitation`

| Column | Type | Notes |
|--------|------|--------|
| invitation_id | PK | |
| tenant_id | FK | |
| email | varchar | lowercased |
| token_hash | varchar | store SHA-256 of secret; never log raw token |
| role | varchar | `user` \| `admin` |
| permission_group_id | nullable | |
| invited_by_user_id | FK | |
| status | enum | `pending` \| `accepted` \| `expired` \| `revoked` |
| expires_at | timestamp | default now + 72h |
| accepted_at | nullable | |
| created_at | timestamp | |

### `oaao_password_reset`

| Column | Type | Notes |
|--------|------|--------|
| reset_id | PK | |
| user_id | FK | |
| token_hash | varchar | |
| status | enum | `pending` \| `used` \| `expired` |
| expires_at | timestamp | default now + 1h |
| used_at | nullable | |

**Indexes:** unique `(tenant_id, email)` where status=`pending`; index `token_hash`.

---

## 4. API surface (PHP, JSON envelope)

| Story | Method / path | Auth |
|-------|---------------|------|
| PLAT-2-S2 | `POST /user/api/users_invite` | admin |
| PLAT-2-S2 | `POST /user/api/users_invite_resend` | admin |
| PLAT-2-S2 | `POST /user/api/users_invite_revoke` | admin |
| PLAT-2-S4 | `GET /user/api/register_validate?token=` | public |
| PLAT-2-S4 | `POST /user/api/register_complete` | public |
| PLAT-2-S5 | `POST /user/api/password_reset_request` | public |
| PLAT-2-S5 | `GET /user/api/password_reset_validate?token=` | public |
| PLAT-2-S5 | `POST /user/api/password_reset_complete` | public |

**Security (hard):**

- Single-use tokens; constant-time compare on hash.
- Rate limit: invite send 10/h/tenant; reset request 5/h/IP.
- `password_reset_request`: always HTTP 200 + generic message (no email enumeration).
- Password policy: match existing auth hashing (same as `users_save`).

---

## 5. UX / routes

| Route | Shell | Notes |
|-------|-------|--------|
| `register` | public SPA page (auth module or core) | token in query |
| `reset-password` | public SPA | |
| Settings → Users | existing panel | Pending table + **Invite** button |

**i18n:** `oaaoai/user/default/lang/{en,zh}.php` + mail template keys.

---

## 6. Task breakdown → Jira

| Story | Tasks | Owner |
|-------|-------|-------|
| **PLAT-2-S1** | Migration PG + SQLite installers; `_ensure_*` idempotent | php-lead |
| **PLAT-2-S2** | `users_invite*.php` closures; deprecate password on insert in `users_save.php` | php-lead |
| **PLAT-2-S3** | Mail templates + queue worker hook | php-lead |
| **PLAT-2-S4** | Register SPA + validate/complete APIs | php-lead |
| **PLAT-2-S5** | Reset flow APIs + SPA | php-lead |
| **PLAT-2-S6** | Settings UI: pending list, resend, revoke | php-lead |
| **PLAT-2-S7** | PHPUnit/API tests: expired, reused, enumeration | qa-lead |

---

## 7. KPI & acceptance (CS-W1–W3)

| KPI ID | Definition | Target | Measured |
|--------|------------|--------|----------|
| **plat2_invite_e2e** | send → email captured (mailhog) → register → login | 1 happy path green on staging | manual + CI API test |
| **plat2_reset_e2e** | forgot → email → reset → login | 1 happy path green | CI |
| **plat2_security_reject** | expired / reused / revoked token | 100% reject | automated |
| **plat2_no_admin_password** | `users_save` without `user_id` + password | HTTP 403 | CI |
| **plat2_i18n** | invite + reset mail EN + zh | both render | snapshot test optional |

**Epic DoD:** Admin cannot create user with password; invitee self-registers; forgot password works.

---

## 8. Dependencies & risks

| Risk | Mitigation |
|------|------------|
| Existing scripts rely on `users_save` create | Document break; provide `users_invite` CLI or keep platform-only bootstrap user |
| Mail not configured in dev | Mailhog in compose; dev doc in Debug_Guide |
| UX-1 blocked on register | Register page fires `preferences_json.onboarding_pending` flag for later UX-1 |

---

## 9. Implementation order (CS-W1 week)

1. PLAT-2-S1 schema  
2. PLAT-2-S2 + S3 (invite + mail)  
3. PLAT-2-S4 + S5 (public pages) — can start CS-W2 if W1 slips  
4. PLAT-2-S6 + S7  
