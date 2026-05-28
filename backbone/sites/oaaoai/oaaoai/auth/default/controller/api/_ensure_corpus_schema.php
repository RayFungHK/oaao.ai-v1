<?php

declare(strict_types=1);

/**
 * Idempotent PostgreSQL DDL for Corpus Studio (EPIC-CS-1).
 */
function oaao_auth_ensure_corpus_schema(\PDO $pdo): void
{
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_corpus_profile (
        corpus_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        workspace_id BIGINT DEFAULT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        tags_json TEXT DEFAULT NULL,
        style_json TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT \'draft\',
        error_message TEXT DEFAULT NULL,
        created_by BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_corpus_profile_scope
        ON oaao_corpus_profile(tenant_id, workspace_id, created_by)',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_corpus_profile_status
        ON oaao_corpus_profile(tenant_id, status)',
    );

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_corpus_source (
        source_id BIGSERIAL PRIMARY KEY,
        corpus_id BIGINT NOT NULL REFERENCES oaao_corpus_profile(corpus_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        locator_json TEXT NOT NULL,
        label TEXT DEFAULT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        byte_size BIGINT DEFAULT NULL,
        mime_type TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_corpus_source_corpus
        ON oaao_corpus_source(corpus_id, sort_order, source_id)',
    );

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_corpus_segment (
        segment_id BIGSERIAL PRIMARY KEY,
        corpus_id BIGINT NOT NULL REFERENCES oaao_corpus_profile(corpus_id) ON DELETE CASCADE,
        source_id BIGINT DEFAULT NULL REFERENCES oaao_corpus_source(source_id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        classify_json TEXT DEFAULT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_corpus_segment_corpus
        ON oaao_corpus_segment(corpus_id, ordinal)',
    );

    oaao_auth_ensure_corpus_profile_analyze_columns($pdo);
}

function oaao_auth_ensure_corpus_profile_analyze_columns(\PDO $pdo): void
{
    $alters = [
        'ALTER TABLE oaao_corpus_profile ADD COLUMN IF NOT EXISTS analyze_job_id TEXT DEFAULT NULL',
        'ALTER TABLE oaao_corpus_profile ADD COLUMN IF NOT EXISTS analyze_started_at TIMESTAMPTZ DEFAULT NULL',
    ];
    foreach ($alters as $sql) {
        try {
            $pdo->exec($sql);
        } catch (\Throwable) {
        }
    }
}
