<?php

/**
 * Raw SQLite DDL for oaao (SchemaBuilder targets MySQL — SQLite needs this path).
 * Used by install_action and auth bootstrap when the DB file exists but tables are missing.
 *
 * {@code oaao_purpose} is **not** defined here — routing purposes live on PostgreSQL canonical only
 * ({@see oaao_auth_ensure_pg_purpose_table}).
 */

function oaao_auth_ensure_sqlite_chat_endpoint_tables(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_chat_endpoint (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT \'single\',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        config_json TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_chat_endpoint_llm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_endpoint_id INTEGER NOT NULL,
        endpoint_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT \'default\'
    )');
}

function oaao_auth_install_sqlite_core_schema(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_user (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        login_name TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT \'\',
        email TEXT DEFAULT NULL,
        role TEXT NOT NULL DEFAULT \'user\',
        session_key TEXT DEFAULT NULL,
        session_expires TEXT DEFAULT NULL,
        last_login TEXT DEFAULT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_endpoint (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        endpoint_type TEXT NOT NULL DEFAULT \'chat\',
        base_url TEXT DEFAULT NULL,
        model TEXT NOT NULL,
        api_key_ref TEXT DEFAULT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        workspace_id INTEGER DEFAULT NULL,
        title TEXT DEFAULT NULL,
        model TEXT DEFAULT NULL,
        params_json TEXT DEFAULT NULL,
        share_slug TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS '
        . 'idx_conversation_share_slug ON oaao_conversation(share_slug) '
        . 'WHERE share_slug IS NOT NULL');
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        feedback TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    oaao_auth_ensure_sqlite_chat_endpoint_tables($pdo);

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation_attachment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT DEFAULT NULL,
        storage_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        extract_status TEXT NOT NULL DEFAULT "pending",
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT DEFAULT NULL
    )');
    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conv_attachment_conv ON oaao_conversation_attachment(conversation_id)');
    } catch (\Throwable $_) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT \'personal\',
        workspace_key TEXT DEFAULT NULL,
        owner_user_id INTEGER DEFAULT NULL,
        description TEXT DEFAULT NULL,
        qdrant_collection TEXT DEFAULT NULL,
        qdrant_url TEXT DEFAULT NULL,
        qdrant_api_key_ref TEXT DEFAULT NULL,
        arango_url TEXT DEFAULT NULL,
        arango_database TEXT DEFAULT NULL,
        arango_user_ref TEXT DEFAULT NULL,
        arango_password_ref TEXT DEFAULT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        graph_mode INTEGER NOT NULL DEFAULT 0,
        glossary_json TEXT DEFAULT NULL,
        permissions_json TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_container (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        permissions_json TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL,
        parent_container_id INTEGER DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_document (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id INTEGER NOT NULL,
        container_id INTEGER DEFAULT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT DEFAULT NULL,
        storage_path TEXT DEFAULT NULL,
        external_id TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        source_text TEXT DEFAULT NULL,
        embed_status TEXT NOT NULL DEFAULT "pending",
        embed_attempts INTEGER NOT NULL DEFAULT 0,
        embed_error TEXT DEFAULT NULL,
        embedded_chunks INTEGER NOT NULL DEFAULT 0,
        last_job_at TEXT DEFAULT NULL,
        embedded_at TEXT DEFAULT NULL,
        graph_status TEXT DEFAULT NULL,
        graph_error TEXT DEFAULT NULL,
        graph_started_at TEXT DEFAULT NULL,
        graph_finished_at TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT NULL
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_group_name ON oaao_group(name)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group_member (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_group_member_user ON oaao_group_member(user_id)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_app_setting (
        name TEXT PRIMARY KEY NOT NULL,
        value TEXT
    )');

    // Tranche H — sidecar-written IQS/ACCS (mirrors migrations/versions/0001_initial.py).
    // AIQS v2 columns (Tranche M1) mirror migrations/versions/0003_aiqs_blob.py:
    //   - aiqs_blob_json  TEXT       NULL    — full per-turn AIQS v2 blob
    //   - complete        INTEGER    NOT NULL DEFAULT 1  (SQLite's encoding of BOOLEAN TRUE)
    //   - topic_shift     INTEGER    NOT NULL DEFAULT 0  (BOOLEAN FALSE)
    // Existing databases get the same columns via oaao_auth_upgrade_sqlite_core_schema() below.
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_turn_score (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        conversation_id INTEGER NOT NULL,
        turn_index INTEGER NOT NULL,
        iqs REAL NOT NULL,
        accs REAL NOT NULL,
        iqs_dims_json TEXT NOT NULL,
        accs_dims_json TEXT NOT NULL,
        iqs_reasons_json TEXT,
        accs_reasons_json TEXT,
        scorer_version TEXT NOT NULL,
        scored_at REAL NOT NULL,
        aiqs_blob_json TEXT,
        complete INTEGER NOT NULL DEFAULT 1,
        topic_shift INTEGER NOT NULL DEFAULT 0,
        UNIQUE(conversation_id, turn_index)
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_conv ON oaao_turn_score(conversation_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_iqs ON oaao_turn_score(iqs DESC)');
}

/**
 * Idempotent per-boot upgrades for schemas that were created before
 * a column/index was added. Safe to call on every request because
 * each step checks for existence first. Kept out of the "fresh
 * install" core path above so a fresh DB pays only the CREATE cost.
 *
 * Currently handles:
 *   * ``oaao_conversation.share_slug``  — short-hash share links (feature 2026-04-21).
 *   * ``oaao_conversation.workspace_id`` — nullable workspace scope for chat threads ({@code null} = personal).
 *   * ``oaao_turn_score.{aiqs_blob_json, complete, topic_shift}``
 *                                       — AIQS v2 columns (Tranche M1, 2026-04-20).
 */
function oaao_auth_upgrade_sqlite_core_schema(\PDO $pdo): void
{
    try {
        oaao_auth_ensure_sqlite_chat_endpoint_tables($pdo);
    } catch (\Throwable $_) {
    }

    try {
        $hasConv = (bool) $pdo->query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='oaao_conversation'",
        )->fetchColumn();
    } catch (\Throwable $_) {
        return;
    }
    if (!$hasConv) {
        return;
    }

    try {
        $cols = $pdo->query('PRAGMA table_info(oaao_conversation)')
            ->fetchAll(\PDO::FETCH_ASSOC) ?: [];
    } catch (\Throwable $_) {
        $cols = [];
    }
    $hasSlug = false;
    foreach ($cols as $c) {
        if (strtolower((string) ($c['name'] ?? '')) === 'share_slug') {
            $hasSlug = true;
            break;
        }
    }
    if (!$hasSlug) {
        try {
            $pdo->exec('ALTER TABLE oaao_conversation ADD COLUMN share_slug TEXT DEFAULT NULL');
        } catch (\Throwable $_) {
            // Concurrent boot might have won the race — harmless.
        }
    }
    $hasWs = false;
    foreach ($cols as $c) {
        if (strtolower((string) ($c['name'] ?? '')) === 'workspace_id') {
            $hasWs = true;
            break;
        }
    }
    if (!$hasWs) {
        try {
            $pdo->exec('ALTER TABLE oaao_conversation ADD COLUMN workspace_id INTEGER DEFAULT NULL');
        } catch (\Throwable $_) {
        }
    }
    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_workspace ON oaao_conversation(user_id, workspace_id)');
    } catch (\Throwable $_) {
    }
    try {
        $pdo->exec(
            'CREATE UNIQUE INDEX IF NOT EXISTS '
            . 'idx_conversation_share_slug ON oaao_conversation(share_slug) '
            . 'WHERE share_slug IS NOT NULL',
        );
    } catch (\Throwable $_) {
        // Partial-index unsupported on very old SQLite — skipped.
    }

    // AIQS v2 — per-turn blob + boolean finalisation/topic-shift flags.
    // Mirrors migrations/versions/0003_aiqs_blob.py.
    //
    // Legacy-install recovery (2026-04-20): on databases that predate
    // Tranche H (Phase-1b IQS/ACCS), the ``oaao_turn_score`` table was
    // never created by the fresh-install branch — ``oaao_user`` already
    // existed so the CREATE path was skipped. The sidecar's Python
    // writer INSERTs without a lazy CREATE, so rows were silently
    // dropped and the admin dashboard crashed with "no such table".
    // Create the v2-shaped table here idempotently; the ALTER TABLE
    // ADD COLUMN checks below then become no-ops on a brand-new create.
    try {
        $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_turn_score (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            conversation_id INTEGER NOT NULL,
            turn_index INTEGER NOT NULL,
            iqs REAL NOT NULL,
            accs REAL NOT NULL,
            iqs_dims_json TEXT NOT NULL,
            accs_dims_json TEXT NOT NULL,
            iqs_reasons_json TEXT,
            accs_reasons_json TEXT,
            scorer_version TEXT NOT NULL,
            scored_at REAL NOT NULL,
            aiqs_blob_json TEXT,
            complete INTEGER NOT NULL DEFAULT 1,
            topic_shift INTEGER NOT NULL DEFAULT 0,
            UNIQUE(conversation_id, turn_index)
        )');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_conv ON oaao_turn_score(conversation_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_iqs ON oaao_turn_score(iqs DESC)');
    } catch (\Throwable $_) {
        // Concurrent boot might have won the race — harmless.
    }

    try {
        $hasTurnScore = (bool) $pdo->query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='oaao_turn_score'",
        )->fetchColumn();
    } catch (\Throwable $_) {
        $hasTurnScore = false;
    }
    if ($hasTurnScore) {
        try {
            $tsCols = $pdo->query('PRAGMA table_info(oaao_turn_score)')
                ->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable $_) {
            $tsCols = [];
        }
        $tsHave = [];
        foreach ($tsCols as $c) {
            $n = strtolower((string) ($c['name'] ?? ''));
            if ($n !== '') {
                $tsHave[$n] = true;
            }
        }
        // SQLite's ALTER TABLE ADD COLUMN supports a literal
        // NOT NULL DEFAULT since 3.2.0, which is well below the
        // versions we support. Wrapped in try/catch so a concurrent
        // boot losing the race is harmless.
        if (!isset($tsHave['aiqs_blob_json'])) {
            try {
                $pdo->exec('ALTER TABLE oaao_turn_score ADD COLUMN aiqs_blob_json TEXT');
            } catch (\Throwable $_) {
            }
        }
        if (!isset($tsHave['complete'])) {
            try {
                $pdo->exec('ALTER TABLE oaao_turn_score ADD COLUMN complete INTEGER NOT NULL DEFAULT 1');
            } catch (\Throwable $_) {
            }
        }
        if (!isset($tsHave['topic_shift'])) {
            try {
                $pdo->exec('ALTER TABLE oaao_turn_score ADD COLUMN topic_shift INTEGER NOT NULL DEFAULT 0');
            } catch (\Throwable $_) {
            }
        }
    }

    // oaao_vault_container.permissions_json — per-folder ACL overlay.
    try {
        $hasVc = (bool) $pdo->query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='oaao_vault_container'",
        )->fetchColumn();
    } catch (\Throwable $_) {
        $hasVc = false;
    }
    if ($hasVc) {
        try {
            $vcCols = $pdo->query('PRAGMA table_info(oaao_vault_container)')
                ->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable $_) {
            $vcCols = [];
        }
        $vcHave = [];
        foreach ($vcCols as $c) {
            $n = strtolower((string) ($c['name'] ?? ''));
            if ($n !== '') {
                $vcHave[$n] = true;
            }
        }
        if (!isset($vcHave['permissions_json'])) {
            try {
                $pdo->exec('ALTER TABLE oaao_vault_container ADD COLUMN permissions_json TEXT DEFAULT NULL');
            } catch (\Throwable $_) {
            }
        }
        if (!isset($vcHave['parent_container_id'])) {
            try {
                $pdo->exec('ALTER TABLE oaao_vault_container ADD COLUMN parent_container_id INTEGER DEFAULT NULL');
            } catch (\Throwable $_) {
            }
        }
    }

    // oaao_vault — ArangoDB connection refs for GraphRAG sidecar (optional).
    try {
        $hasV = (bool) $pdo->query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='oaao_vault'",
        )->fetchColumn();
    } catch (\Throwable $_) {
        $hasV = false;
    }
    if ($hasV) {
        try {
            $vCols = $pdo->query('PRAGMA table_info(oaao_vault)')
                ->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable $_) {
            $vCols = [];
        }
        $vHave = [];
        foreach ($vCols as $c) {
            $n = strtolower((string) ($c['name'] ?? ''));
            if ($n !== '') {
                $vHave[$n] = true;
            }
        }
        foreach (['arango_url', 'arango_database', 'arango_user_ref', 'arango_password_ref'] as $ac) {
            if (!isset($vHave[$ac])) {
                try {
                    $pdo->exec("ALTER TABLE oaao_vault ADD COLUMN {$ac} TEXT DEFAULT NULL");
                } catch (\Throwable $_) {
                }
            }
        }
    }

    // Access groups (vault ACL + Settings → Groups). Idempotent for legacy DBs.
    try {
        $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT NULL
        )');
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_group_name ON oaao_group(name)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group_member (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, user_id)
        )');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_group_member_user ON oaao_group_member(user_id)');
    } catch (\Throwable $_) {
    }
}

function oaao_auth_seed_sqlite_migration_rows(\PDO $pdo): void
{
    $migrations = [
        '2026_04_10_000001_CreateUserTable',
        '2026_04_10_000001_CreateEndpointTable',
        '2026_04_10_000001_CreateConversationTables',
        '2026_04_13_000001_CreateChatEndpointTables',
        '2026_04_14_000001_CreateVaultTables',
        '2026_04_15_000001_CreateAbilityTable',
    ];
    $st = $pdo->prepare('INSERT OR IGNORE INTO oaao_razy_migrations (migration, batch) VALUES (?, ?)');
    foreach ($migrations as $name) {
        $st->execute([$name, 1]);
    }
}
