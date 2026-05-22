<?php

/**
 * Workspace / conversation micro skills (adjunct SQLite).
 */
function oaao_chat_ensure_micro_skill_schema(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_micro_skill (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        workspace_id INTEGER DEFAULT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT "conversation",
        title TEXT NOT NULL,
        summary TEXT DEFAULT NULL,
        bind_ref TEXT DEFAULT NULL,
        payload_json TEXT DEFAULT NULL,
        preview_markdown TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT "draft",
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_micro_skill_id_user
         ON oaao_micro_skill(user_id, skill_id)',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_micro_skill_workspace
         ON oaao_micro_skill(workspace_id, status)',
    );
}
