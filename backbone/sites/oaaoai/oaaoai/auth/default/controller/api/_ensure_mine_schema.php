<?php

declare(strict_types=1);

/**
 * Idempotent PostgreSQL DDL for Data Mining mines / sources / runs.
 */
function oaao_auth_ensure_mine_schema(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_mine (
        mine_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        owner_user_id BIGINT NOT NULL,
        workspace_id BIGINT DEFAULT NULL,
        label TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        cron_expr TEXT DEFAULT NULL,
        interval_minutes INTEGER DEFAULT NULL,
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        schema_json TEXT DEFAULT NULL,
        llm_hints_json TEXT DEFAULT NULL,
        notify_json TEXT DEFAULT NULL,
        sqlite_path TEXT DEFAULT NULL,
        last_run_at TIMESTAMPTZ DEFAULT NULL,
        next_run_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_mine_owner
        ON oaao_mine(tenant_id, owner_user_id)');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_mine_next_run
        ON oaao_mine(is_enabled, next_run_at)
        WHERE is_enabled = 1 AND next_run_at IS NOT NULL');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_mine_source (
        source_id BIGSERIAL PRIMARY KEY,
        mine_id BIGINT NOT NULL REFERENCES oaao_mine(mine_id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT \'http_json\',
        config_json TEXT DEFAULT NULL,
        fetch_mode TEXT NOT NULL DEFAULT \'http\',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_mine_source_mine
        ON oaao_mine_source(mine_id, sort_order)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_mine_run (
        run_id BIGSERIAL PRIMARY KEY,
        mine_id BIGINT NOT NULL REFERENCES oaao_mine(mine_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT \'queued\',
        stats_json TEXT DEFAULT NULL,
        error_text TEXT DEFAULT NULL,
        started_at TIMESTAMPTZ DEFAULT NULL,
        finished_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_mine_run_mine
        ON oaao_mine_run(mine_id, created_at DESC)');
}
