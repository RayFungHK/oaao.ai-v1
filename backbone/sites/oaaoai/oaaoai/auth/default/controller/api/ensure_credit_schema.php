<?php

declare(strict_types=1);

/** User credits + ledger ({@see auth} {@code ensureCreditSchema}). */
return function (\PDO $pdo): void {
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    $userCols = [
        'preferences_json' => 'ALTER TABLE oaao_user ADD COLUMN preferences_json TEXT DEFAULT NULL',
        'credit_balance'   => 'ALTER TABLE oaao_user ADD COLUMN credit_balance NUMERIC DEFAULT NULL',
    ];
    foreach ($userCols as $_col => $ddl) {
        try {
            $pdo->exec($ddl);
        } catch (\Throwable) {
        }
    }

    try {
        $pdo->exec('ALTER TABLE oaao_usage_event ADD COLUMN user_id BIGINT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_usage_event ADD COLUMN purpose_key TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_usage_event_user_day ON oaao_usage_event(tenant_id, user_id, created_at DESC)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_usage_event_purpose ON oaao_usage_event(tenant_id, purpose_key, created_at DESC)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_usage_event_user_purpose ON oaao_usage_event(tenant_id, user_id, purpose_key, created_at DESC)');
    } catch (\Throwable) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_credit_ledger (
        ledger_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        delta_credits NUMERIC NOT NULL,
        balance_after NUMERIC DEFAULT NULL,
        reason TEXT NOT NULL DEFAULT \'\',
        ref_kind TEXT DEFAULT NULL,
        ref_id BIGINT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_credit_ledger_user ON oaao_credit_ledger(tenant_id, user_id, created_at DESC)');
    } catch (\Throwable) {
    }
};
