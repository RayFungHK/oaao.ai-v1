<?php

declare(strict_types=1);

/** Workspace / conversation micro skills — adjunct SQLite ({@see chat} {@code ensureMicroSkillSchema}). */
return function (\PDO $pdo): void {
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

    $cols = [];
    foreach ($pdo->query('PRAGMA table_info(oaao_micro_skill)') as $row) {
        if (\is_array($row) && isset($row['name'])) {
            $cols[(string) $row['name']] = true;
        }
    }
    if (! isset($cols['version'])) {
        $pdo->exec('ALTER TABLE oaao_micro_skill ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
    if (! isset($cols['parent_skill_id'])) {
        $pdo->exec('ALTER TABLE oaao_micro_skill ADD COLUMN parent_skill_id TEXT DEFAULT NULL');
    }
    if (! isset($cols['usage_count'])) {
        $pdo->exec('ALTER TABLE oaao_micro_skill ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0');
    }
    if (! isset($cols['last_used_at'])) {
        $pdo->exec('ALTER TABLE oaao_micro_skill ADD COLUMN last_used_at TEXT DEFAULT NULL');
    }
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_micro_skill_parent
         ON oaao_micro_skill(user_id, parent_skill_id)',
    );
};
