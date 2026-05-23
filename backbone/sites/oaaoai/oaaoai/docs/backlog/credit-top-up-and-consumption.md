# Credit consumption & top-up (backlog)

Status: **partial foundation shipped** — ledger + debit on chat completion; **top-up / purchase not built**.

## Shipped (M1)

| Area | Implementation |
|------|----------------|
| Usage ledger | `oaao_usage_event` + `user_id`; chat records **total tokens** (prompt + completion) |
| Credit debit | `oaao_credit_ledger`; formula on chat completion |
| User balance | `oaao_user.credit_balance` (`NULL` = unlimited) |
| Admin assign | `POST /user/api/users_save` with `credit_balance` |
| Config | Endpoint `config_json.tokens_per_credit`; purpose `meta_json.credit_multiplier`; chat profile `config_json.credit_multiplier` |
| User UI | Preferences → **Dashboard** (30d tokens, balance, ledger snippet); **Personal** (profile / password / language) |

### Credit formula

```
credits_debited = (total_tokens / tokens_per_credit) × purpose_multiplier × chat_endpoint_multiplier
```

Defaults: `tokens_per_credit = 1000`, multipliers = `1`.

## Not built (defer)

### Credit consumption (enhancements)

- [ ] Debit on vault ASR / embed / graph_index (char/chunk-based conversion policy)
- [ ] Block chat send when `credit_balance <= 0` (private tenant + public tenant)
- [ ] Chat profile editor UI field for `credit_multiplier` (JSON manual edit today)
- [ ] Per-tenant policy: enforce credits vs audit-only ledger when balance is NULL
- [ ] Platform reconciliation view (tenant credits vs usage)

### Top-up

- [ ] **Private tenant:** admin grant / adjust via Users settings UI (`credit_balance` field)
- [ ] **Public tenant:** self-serve purchase flow (payment provider TBD)
- [ ] Ledger `reason = top_up` with positive `delta_credits` + payment reference in `meta_json`
- [ ] Email/receipt hook (optional)
- [ ] Signup welcome credit grant when `signup_mode = public`

### Suggested schema (top-up)

Reuse `oaao_credit_ledger`:

```sql
-- grant example
INSERT INTO oaao_credit_ledger (tenant_id, user_id, delta_credits, balance_after, reason, ref_kind, ref_id, meta_json)
VALUES (?, ?, +100, ?, 'top_up', 'payment', ?, '{"provider":"stripe","session_id":"…"}');
UPDATE oaao_user SET credit_balance = credit_balance + 100 WHERE user_id = ?;
```

### API sketch (future)

| Method | Path | Role |
|--------|------|------|
| POST | `/user/api/credits_top_up` | Admin grant (private tenant) |
| POST | `/billing/api/checkout_session` | Public tenant purchase (Stripe/etc.) |
| POST | `/billing/api/webhook` | Provider webhook → ledger credit |

## Related files

- `core/default/library/CreditLedgerRepository.php`
- `core/default/library/UsageEventRepository.php`
- `auth/default/controller/api/_ensure_credit_schema.php`
- `core/default/webassets/js/user-preferences-panels.js`
- `core/default/controller/core.php` (PreferencesRegister seed)
