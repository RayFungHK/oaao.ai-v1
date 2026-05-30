<?php

declare(strict_types=1);

/**
 * Add columns to existing deployments (CREATE TABLE IF NOT EXISTS does not alter old tables).
 */
function oaao_auth_ensure_research_watch_columns(\PDO $pdo): void
{
    $alters = [
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS config_json TEXT DEFAULT NULL',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ DEFAULT NULL',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS interval_minutes INTEGER DEFAULT NULL',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS schedule_start_time TEXT DEFAULT \'09:00\'',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT \'UTC\'',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ DEFAULT NULL',
        'ALTER TABLE oaao_research_watch ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NULL',
    ];

    foreach ($alters as $sql) {
        try {
            $pdo->exec($sql);
        } catch (\Throwable) {
        }
    }

    $itemAlters = [
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS match_confidence REAL DEFAULT NULL',
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS match_reason TEXT DEFAULT NULL',
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS match_hit SMALLINT DEFAULT NULL',
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS needs_refetch SMALLINT NOT NULL DEFAULT 0',
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS refetch_error TEXT DEFAULT NULL',
        'ALTER TABLE oaao_research_item ADD COLUMN IF NOT EXISTS refetch_started_at TIMESTAMPTZ DEFAULT NULL',
    ];
    foreach ($itemAlters as $sql) {
        try {
            $pdo->exec($sql);
        } catch (\Throwable) {
        }
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_item_refetch
            ON oaao_research_item(watch_id, needs_refetch)
            WHERE needs_refetch IN (1, 2)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('UPDATE oaao_research_watch SET schedule_start_time = \'09:00\' WHERE schedule_start_time IS NULL');
        $pdo->exec('UPDATE oaao_research_watch SET schedule_timezone = \'UTC\' WHERE schedule_timezone IS NULL');
    } catch (\Throwable) {
    }
}

/** Article Research watches / sources / runs ({@see auth} {@code ensureResearchSchema}). */
return function (\PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_research_watch (
        watch_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        owner_user_id BIGINT NOT NULL,
        workspace_id BIGINT DEFAULT NULL,
        label TEXT NOT NULL,
        vault_id BIGINT NOT NULL,
        container_id BIGINT DEFAULT NULL,
        summary_language TEXT NOT NULL DEFAULT \'zh-TW\',
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        config_json TEXT DEFAULT NULL,
        last_run_at TIMESTAMPTZ DEFAULT NULL,
        interval_minutes INTEGER DEFAULT NULL,
        schedule_start_time TEXT NOT NULL DEFAULT \'09:00\',
        schedule_timezone TEXT NOT NULL DEFAULT \'UTC\',
        next_run_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    oaao_auth_ensure_research_watch_columns($pdo);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_watch_owner
        ON oaao_research_watch(tenant_id, owner_user_id)');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_watch_next_run
        ON oaao_research_watch(is_enabled, next_run_at)
        WHERE is_enabled = 1 AND next_run_at IS NOT NULL');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_research_source (
        source_id BIGSERIAL PRIMARY KEY,
        watch_id BIGINT NOT NULL REFERENCES oaao_research_watch(watch_id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT \'url\',
        config_json TEXT DEFAULT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_source_watch
        ON oaao_research_source(watch_id, sort_order)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_research_run (
        run_id BIGSERIAL PRIMARY KEY,
        watch_id BIGINT NOT NULL REFERENCES oaao_research_watch(watch_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT \'queued\',
        stats_json TEXT DEFAULT NULL,
        error_text TEXT DEFAULT NULL,
        started_at TIMESTAMPTZ DEFAULT NULL,
        finished_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_run_watch
        ON oaao_research_run(watch_id, created_at DESC)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_research_item (
        item_id BIGSERIAL PRIMARY KEY,
        watch_id BIGINT NOT NULL REFERENCES oaao_research_watch(watch_id) ON DELETE CASCADE,
        canonical_url TEXT NOT NULL,
        content_hash TEXT DEFAULT NULL,
        title TEXT DEFAULT NULL,
        document_id BIGINT DEFAULT NULL,
        summary_document_id BIGINT DEFAULT NULL,
        first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (watch_id, canonical_url)
    )');

    try {
        $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_research_fetch_job (
            job_id BIGSERIAL PRIMARY KEY,
            run_id BIGINT NOT NULL REFERENCES oaao_research_run(run_id) ON DELETE CASCADE,
            watch_id BIGINT NOT NULL REFERENCES oaao_research_watch(watch_id) ON DELETE CASCADE,
            source_id BIGINT DEFAULT NULL REFERENCES oaao_research_source(source_id) ON DELETE SET NULL,
            canonical_url TEXT NOT NULL,
            title TEXT DEFAULT NULL,
            status TEXT NOT NULL DEFAULT \'queued\',
            error_text TEXT DEFAULT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            claimed_at TIMESTAMPTZ DEFAULT NULL,
            started_at TIMESTAMPTZ DEFAULT NULL,
            finished_at TIMESTAMPTZ DEFAULT NULL
        )');

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_research_fetch_job_queue
            ON oaao_research_fetch_job(status, created_at)
            WHERE status IN (\'queued\', \'running\')');
    } catch (\Throwable) {
    }
};
