<?php

/**
 * PostgreSQL DDL for **canonical global** oaao data (users, endpoints, vaults, migrations tracking, …).
 *
 * Conversation / message rows are **not** written here by the app — those live on adjunct SQLite
 * ({@see oaao_auth_install_sqlite_local_schema}). Legacy PG copies of chat DDL remain harmless if empty.
 */

/**
 * Purpose routing keys → optional default {@code oaao_endpoint} (admin-managed).
 *
 * **PostgreSQL only** — not created on file-based SQLite core ({@see oaao_auth_install_sqlite_core_schema});
 * adjunct chat SQLite ({@see oaao_auth_install_sqlite_local_schema}) is unrelated.
 *
 * Idempotent — safe on every boot ({@see oaao_auth_ensure_pg_core_tables}).
 */
function oaao_auth_ensure_pg_purpose_table(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_purpose (
        id BIGSERIAL PRIMARY KEY,
        purpose_key TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        default_endpoint_id BIGINT DEFAULT NULL REFERENCES oaao_endpoint(id) ON DELETE SET NULL,
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 500,
        meta_json TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_purpose_key ON oaao_purpose(purpose_key)');
}

/**
 * Chat selector profiles — idempotent for databases that already had users before chat DDL shipped.
 *
 * @see oaao_auth_ensure_pg_core_tables
 */
function oaao_auth_ensure_pg_chat_endpoint_tables(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_chat_endpoint (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT \'single\',
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        is_default SMALLINT NOT NULL DEFAULT 0,
        config_json TEXT DEFAULT NULL,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_chat_endpoint_llm (
        id BIGSERIAL PRIMARY KEY,
        chat_endpoint_id BIGINT NOT NULL,
        endpoint_id BIGINT NOT NULL,
        role TEXT NOT NULL DEFAULT \'default\'
    )');
}

function oaao_auth_install_pg_core_schema(\PDO $pdo): void
{
    // Idempotent DDL — aligns with SQLite core schema semantics.
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_user (
        user_id BIGSERIAL PRIMARY KEY,
        login_name TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT \'\',
        email TEXT DEFAULT NULL,
        role TEXT NOT NULL DEFAULT \'user\',
        session_key TEXT DEFAULT NULL,
        session_expires TIMESTAMPTZ DEFAULT NULL,
        last_login TIMESTAMPTZ DEFAULT NULL,
        disabled SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_endpoint (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint_type TEXT NOT NULL DEFAULT \'chat\',
        base_url TEXT DEFAULT NULL,
        model TEXT NOT NULL,
        api_key_ref TEXT DEFAULT NULL,
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        config_json TEXT DEFAULT NULL,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        workspace_id BIGINT DEFAULT NULL,
        title TEXT DEFAULT NULL,
        model TEXT DEFAULT NULL,
        params_json TEXT DEFAULT NULL,
        share_slug TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_share_slug ON oaao_conversation(share_slug) WHERE share_slug IS NOT NULL');
    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_workspace ON oaao_conversation(user_id, workspace_id)');
    } catch (\Throwable $_) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_message (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        role TEXT NOT NULL,
        content TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        feedback TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )');

    oaao_auth_ensure_pg_chat_endpoint_tables($pdo);

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT \'personal\',
        workspace_key TEXT DEFAULT NULL,
        owner_user_id BIGINT DEFAULT NULL,
        description TEXT DEFAULT NULL,
        qdrant_collection TEXT DEFAULT NULL,
        qdrant_url TEXT DEFAULT NULL,
        qdrant_api_key_ref TEXT DEFAULT NULL,
        arango_url TEXT DEFAULT NULL,
        arango_database TEXT DEFAULT NULL,
        arango_user_ref TEXT DEFAULT NULL,
        arango_password_ref TEXT DEFAULT NULL,
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        graph_mode SMALLINT NOT NULL DEFAULT 0,
        glossary_json TEXT DEFAULT NULL,
        permissions_json TEXT DEFAULT NULL,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_container (
        id BIGSERIAL PRIMARY KEY,
        vault_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        permissions_json TEXT DEFAULT NULL,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL,
        parent_container_id BIGINT DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_document (
        id BIGSERIAL PRIMARY KEY,
        vault_id BIGINT NOT NULL,
        container_id BIGINT DEFAULT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT DEFAULT NULL,
        storage_path TEXT DEFAULT NULL,
        storage_locator_json TEXT DEFAULT NULL,
        external_id TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        source_text TEXT DEFAULT NULL,
        embed_status TEXT NOT NULL DEFAULT \'pending\',
        embed_attempts INTEGER NOT NULL DEFAULT 0,
        embed_error TEXT DEFAULT NULL,
        embedded_chunks INTEGER NOT NULL DEFAULT 0,
        last_job_at TIMESTAMPTZ DEFAULT NULL,
        embedded_at TIMESTAMPTZ DEFAULT NULL,
        graph_status TEXT DEFAULT NULL,
        graph_error TEXT DEFAULT NULL,
        graph_started_at TIMESTAMPTZ DEFAULT NULL,
        graph_finished_at TIMESTAMPTZ DEFAULT NULL,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_group_name ON oaao_group(name)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_group_member (
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_group_member_user ON oaao_group_member(user_id)');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_app_setting (
        name TEXT PRIMARY KEY NOT NULL,
        value TEXT
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_turn_score (
        id BIGSERIAL PRIMARY KEY NOT NULL,
        conversation_id BIGINT NOT NULL,
        turn_index INTEGER NOT NULL,
        iqs DOUBLE PRECISION NOT NULL,
        accs DOUBLE PRECISION NOT NULL,
        iqs_dims_json TEXT NOT NULL,
        accs_dims_json TEXT NOT NULL,
        iqs_reasons_json TEXT,
        accs_reasons_json TEXT,
        scorer_version TEXT NOT NULL,
        scored_at DOUBLE PRECISION NOT NULL,
        aiqs_blob_json TEXT,
        complete SMALLINT NOT NULL DEFAULT 1,
        topic_shift SMALLINT NOT NULL DEFAULT 0,
        UNIQUE(conversation_id, turn_index)
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_conv ON oaao_turn_score(conversation_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_turn_score_iqs ON oaao_turn_score(iqs DESC)');

    oaao_auth_ensure_pg_purpose_table($pdo);
}

/**
 * Align legacy PostgreSQL ``oaao_conversation`` with adjunct SQLite semantics ({@code workspace_id} {@code NULL} = personal).
 */
function oaao_auth_ensure_pg_conversation_workspace_column(\PDO $pdo): void
{
    try {
        $pdo->exec('ALTER TABLE oaao_conversation ADD COLUMN workspace_id BIGINT DEFAULT NULL');
    } catch (\Throwable) {
        // Column already present — harmless on concurrent boots.
    }
    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_workspace ON oaao_conversation(user_id, workspace_id)');
    } catch (\Throwable) {
    }
}

/**
 * Team workspaces (PostgreSQL only) — membership gates chat adjunct {@code workspace_id} scope.
 *
 * Idempotent — safe from {@see oaao_auth_ensure_pg_core_tables}.
 */
function oaao_auth_ensure_pg_workspace_tables(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_workspace (
        workspace_id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_by BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE RESTRICT,
        disabled SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_workspace_member (
        workspace_id BIGINT NOT NULL REFERENCES oaao_workspace(workspace_id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT \'member\',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_workspace_member_user ON oaao_workspace_member(user_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_workspace_created_by ON oaao_workspace(created_by)');

    try {
        $pdo->exec('ALTER TABLE oaao_workspace ADD COLUMN glossary_json TEXT DEFAULT NULL');
    } catch (\Throwable $_) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_workspace_invitation (
        invitation_id BIGSERIAL PRIMARY KEY,
        workspace_id BIGINT NOT NULL REFERENCES oaao_workspace(workspace_id) ON DELETE CASCADE,
        invited_by BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE CASCADE,
        invitee_email TEXT NOT NULL,
        token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT \'pending\',
        expires_at TIMESTAMPTZ NOT NULL,
        role TEXT NOT NULL DEFAULT \'member\',
        accepted_at TIMESTAMPTZ DEFAULT NULL,
        accepted_user_id BIGINT DEFAULT NULL REFERENCES oaao_user(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_workspace_inv_token ON oaao_workspace_invitation(token)');
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_workspace_inv_pending_email ON oaao_workspace_invitation(workspace_id, invitee_email) WHERE status = \'pending\'',
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_workspace_inv_workspace ON oaao_workspace_invitation(workspace_id, status)');
}

/**
 * Vault alignment with {@code oaao_workspace} + sidecar/job queue ({@code oaao_vault_job}) for ASR / embed pipelines.
 *
 * Idempotent — safe from {@see oaao_auth_ensure_pg_core_tables} after workspace DDL.
 */
function oaao_auth_ensure_pg_vault_workspace_and_jobs(\PDO $pdo): void
{
    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD COLUMN workspace_id BIGINT DEFAULT NULL');
    } catch (\Throwable) {
        // Column exists.
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD CONSTRAINT fk_oaao_vault_workspace FOREIGN KEY (workspace_id) REFERENCES oaao_workspace(workspace_id) ON DELETE CASCADE');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_document ADD COLUMN byte_size BIGINT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_document ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD COLUMN arango_url TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }
    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD COLUMN arango_database TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }
    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD COLUMN arango_user_ref TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }
    try {
        $pdo->exec('ALTER TABLE oaao_vault ADD COLUMN arango_password_ref TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_ws_owner ON oaao_vault(workspace_id, owner_user_id)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_personal_owner ON oaao_vault(owner_user_id) WHERE workspace_id IS NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_container_vault ON oaao_vault_container(vault_id)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_document_vault_container ON oaao_vault_document(vault_id, container_id)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_document_vault_embed ON oaao_vault_document(vault_id, embed_status)');
    } catch (\Throwable) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_job (
        job_id BIGSERIAL PRIMARY KEY,
        document_id BIGINT NOT NULL,
        vault_id BIGINT NOT NULL,
        workspace_id BIGINT DEFAULT NULL,
        hook_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT \'queued\',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT DEFAULT NULL,
        payload_json TEXT DEFAULT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NULL,
        finished_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_job_status_created ON oaao_vault_job(status, created_at)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_job_document ON oaao_vault_job(document_id)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_job ADD CONSTRAINT fk_oaao_vault_job_document FOREIGN KEY (document_id) REFERENCES oaao_vault_document(id) ON DELETE CASCADE');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_job ADD CONSTRAINT fk_oaao_vault_job_vault FOREIGN KEY (vault_id) REFERENCES oaao_vault(id) ON DELETE CASCADE');
    } catch (\Throwable) {
    }
}

/**
 * Vault-scoped speaker voiceprint profiles + per-document speaker → profile mapping.
 *
 * Idempotent — safe from {@see oaao_auth_ensure_pg_core_tables} after vault job DDL.
 */
function oaao_auth_ensure_pg_vault_speaker_profiles(\PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_speaker_profile (
        profile_id BIGSERIAL PRIMARY KEY,
        vault_id BIGINT NOT NULL,
        workspace_id BIGINT DEFAULT NULL,
        display_name TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 1,
        created_by BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_vault_document_speaker_map (
        document_id BIGINT NOT NULL,
        speaker_id INTEGER NOT NULL,
        profile_id BIGINT DEFAULT NULL,
        match_confidence DOUBLE PRECISION DEFAULT NULL,
        PRIMARY KEY (document_id, speaker_id)
    )');

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_speaker_profile_vault ON oaao_vault_speaker_profile(vault_id, display_name)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_vault_doc_speaker_map_profile ON oaao_vault_document_speaker_map(profile_id)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_speaker_profile ADD CONSTRAINT fk_oaao_vault_speaker_profile_vault FOREIGN KEY (vault_id) REFERENCES oaao_vault(id) ON DELETE CASCADE');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_document_speaker_map ADD CONSTRAINT fk_oaao_vault_doc_speaker_map_doc FOREIGN KEY (document_id) REFERENCES oaao_vault_document(id) ON DELETE CASCADE');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_document_speaker_map ADD CONSTRAINT fk_oaao_vault_doc_speaker_map_profile FOREIGN KEY (profile_id) REFERENCES oaao_vault_speaker_profile(profile_id) ON DELETE SET NULL');
    } catch (\Throwable) {
    }
}

/**
 * Best-effort migration markers (Razy tracking table must already exist).
 */
function oaao_auth_seed_pg_migration_rows(\PDO $pdo): void
{
    $migrations = [
        '2026_04_10_000001_CreateUserTable',
        '2026_04_10_000001_CreateEndpointTable',
        '2026_04_10_000001_CreateConversationTables',
        '2026_04_13_000001_CreateChatEndpointTables',
        '2026_04_14_000001_CreateVaultTables',
        '2026_04_15_000001_CreateAbilityTable',
        '2026_05_12_000001_CreatePurposeTable',
        '2026_05_15_000001_CreateWorkspaceTables',
        '2026_05_15_000002_CreateWorkspaceInvitationTable',
        '2026_05_15_000003_VaultWorkspaceAndJobQueue',
        '2026_05_19_000001_VaultSpeakerProfiles',
    ];
    foreach ($migrations as $name) {
        try {
            $st = $pdo->prepare('INSERT INTO oaao_razy_migrations (migration, batch) VALUES (?, ?)');
            $st->execute([$name, 1]);
        } catch (\PDOException) {
            // Duplicate or table shape mismatch — ignore for idempotent install.
        }
    }
}
