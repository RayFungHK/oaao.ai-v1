<?php

/**
 * Adjunct SQLite (“split” store): workspace chat / conversation rows, token telemetry,
 * rich history deltas, training snapshots — same spirit as razit exposing {@code getDB}
 * for app data while global identity stays on the primary engine (here: PostgreSQL).
 *
 * Chat APIs must use {@see Module\oaao\auth::getDBSplit()} / {@see getDBLocal()},
 * never the PostgreSQL {@see getDB()} connection.
 */

function oaao_auth_install_sqlite_local_schema(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_local_token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        message_id INTEGER DEFAULT NULL,
        provider TEXT DEFAULT NULL,
        model TEXT DEFAULT NULL,
        prompt_tokens INTEGER DEFAULT NULL,
        completion_tokens INTEGER DEFAULT NULL,
        total_tokens INTEGER DEFAULT NULL,
        cost_usd REAL DEFAULT NULL,
        raw_json TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_local_tokens_conv ON oaao_local_token_usage(conversation_id)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_local_history_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        pg_message_id INTEGER DEFAULT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_local_history_conv ON oaao_local_history_event(conversation_id)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_local_training_material (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT DEFAULT NULL,
        uri TEXT DEFAULT NULL,
        body_text TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        checksum TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    // --- Split workload: chat threads (mirrors PG column semantics; stored only on SQLite) ---
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        workspace_id INTEGER DEFAULT NULL,
        title TEXT DEFAULT NULL,
        model TEXT DEFAULT NULL,
        params_json TEXT DEFAULT NULL,
        share_slug TEXT DEFAULT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_share_slug ON oaao_conversation(share_slug) WHERE share_slug IS NOT NULL');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conversation_user ON oaao_conversation(user_id)');
    // Legacy adjunct DBs may lack workspace_id — upgrade must run before any index references it.
    oaao_auth_upgrade_sqlite_local_adjunct($pdo);
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_workspace ON oaao_conversation(user_id, workspace_id)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        feedback TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_message_conv ON oaao_message(conversation_id)');

    require_once dirname(__DIR__, 4) . '/chat/default/controller/api/_ensure_conversation_material_schema.php';
    oaao_chat_ensure_conversation_material_schema($pdo);

    require_once dirname(__DIR__, 4) . '/slide-designer/default/controller/api/_ensure_slide_project_schema.php';
    oaao_slide_designer_ensure_schema($pdo);
}

/**
 * Idempotent column adds for adjunct SQLite DBs created before newer chat columns shipped.
 */
function oaao_auth_upgrade_sqlite_local_adjunct(\PDO $pdo): void
{
    $names = [];
    $stmt = $pdo->query('PRAGMA table_info(oaao_conversation)');
    if ($stmt !== false) {
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            if (isset($row['name'])) {
                $names[$row['name']] = true;
            }
        }
    }
    if (! isset($names['archived'])) {
        $pdo->exec('ALTER TABLE oaao_conversation ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    }
    if (! isset($names['workspace_id'])) {
        $pdo->exec('ALTER TABLE oaao_conversation ADD COLUMN workspace_id INTEGER DEFAULT NULL');
    }
}

/** Idempotent column adds for {@code oaao_message} on legacy adjunct SQLite DBs. */
function oaao_auth_upgrade_sqlite_message_meta_json(\PDO $pdo): void
{
    $names = [];
    $stmt = $pdo->query('PRAGMA table_info(oaao_message)');
    if ($stmt !== false) {
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            if (isset($row['name'])) {
                $names[$row['name']] = true;
            }
        }
    }
    if (! isset($names['meta_json'])) {
        $pdo->exec('ALTER TABLE oaao_message ADD COLUMN meta_json TEXT DEFAULT NULL');
    }
    if (! isset($names['feedback'])) {
        $pdo->exec('ALTER TABLE oaao_message ADD COLUMN feedback TEXT DEFAULT NULL');
    }
}
