<?php

declare(strict_types=1);

function oaao_slide_designer_ensure_schema(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_slide_project (
        project_id TEXT PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        message_id INTEGER DEFAULT NULL,
        user_id INTEGER NOT NULL,
        workspace_id INTEGER DEFAULT NULL,
        title TEXT DEFAULT NULL,
        slide_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT \'draft\',
        root_path TEXT NOT NULL,
        meta_json TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_slide_project_conv ON oaao_slide_project(conversation_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_slide_project_user ON oaao_slide_project(user_id)');
}
