<?php

declare(strict_types=1);

/**
 * CS-6-S1 — Todo items (PostgreSQL).
 */
function oaao_auth_ensure_todo_schema(\PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS oaao_todo_item (
            todo_id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            user_id BIGINT NOT NULL,
            workspace_id BIGINT,
            title VARCHAR(512) NOT NULL DEFAULT \'\',
            status VARCHAR(32) NOT NULL DEFAULT \'open\',
            priority VARCHAR(16) NOT NULL DEFAULT \'normal\',
            due_at TIMESTAMPTZ,
            context_snippet TEXT,
            conversation_id BIGINT,
            message_id BIGINT,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_todo_item_user_status
         ON oaao_todo_item (tenant_id, user_id, status, updated_at DESC)',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_todo_item_conversation
         ON oaao_todo_item (conversation_id, status)
         WHERE conversation_id IS NOT NULL',
    );
}
