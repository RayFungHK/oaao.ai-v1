<?php

declare(strict_types=1);

/**
 * CS-5-S2 — Calendar events (PostgreSQL).
 */
function oaao_auth_ensure_calendar_schema(\PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS oaao_calendar_event (
            event_id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            workspace_id BIGINT,
            title VARCHAR(512) NOT NULL DEFAULT \'\',
            start_at TIMESTAMPTZ NOT NULL,
            end_at TIMESTAMPTZ NOT NULL,
            all_day BOOLEAN NOT NULL DEFAULT FALSE,
            timezone VARCHAR(64) NOT NULL DEFAULT \'UTC\',
            location TEXT,
            notes TEXT,
            status VARCHAR(32) NOT NULL DEFAULT \'confirmed\',
            conversation_id BIGINT,
            message_id BIGINT,
            created_by BIGINT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_calendar_event_scope
         ON oaao_calendar_event (tenant_id, workspace_id, start_at)',
    );
}
