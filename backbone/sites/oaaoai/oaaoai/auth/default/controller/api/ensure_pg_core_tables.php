<?php

declare(strict_types=1);

require_once __DIR__ . '/_ensure_pg_core_tables.php';

/** Idempotent PostgreSQL core bootstrap ({@see auth} {@code ensurePgCoreTables}). */
return function (\Razy\Database $database): void {
    if (! oaao_auth_database_is_pgsql($database)) {
        return;
    }

    $pdo = $database->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        return;
    }

    // Idempotent — must run even when bootstrap cache short-circuits (new modules added after first boot).
    $this->ensurePgExtensionSchemas($pdo);
    $this->ensurePgStorageSchema($pdo);

    require_once dirname(__DIR__) . '/../library/CrossProcessBootCache.php';
    if (OaaoAuthPgCoreBootstrapCache::isDone() || OaaoAuthCrossProcessBootCache::pgCoreBootDone()) {
        OaaoAuthPgCoreBootstrapCache::markDone();

        return;
    }

    require_once __DIR__ . '/_install_pg_core_schema.php';

    $tracking = new \Razy\Database\MigrationManager($database);
    $tracking->ensureTrackingTable();

    $hasUser = false;
    try {
        $existsStmt = $pdo->query(
            'SELECT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_tables t
                WHERE t.tablename = \'oaao_user\'
                  AND t.schemaname = ANY (SELECT unnest(current_schemas(false)))
            )',
        );
        $hasUser = $existsStmt && (bool) $existsStmt->fetchColumn();
    } catch (\Throwable) {
        $hasUser = false;
    }

    if (! $hasUser) {
        oaao_auth_install_pg_core_schema($pdo);
        oaao_auth_seed_pg_migration_rows($pdo);
    }

    try {
        $pdo->query('SELECT 1 FROM oaao_user LIMIT 1');
    } catch (\Throwable) {
        oaao_auth_install_pg_core_schema($pdo);
        oaao_auth_seed_pg_migration_rows($pdo);
        $pdo->query('SELECT 1 FROM oaao_user LIMIT 1');
    }

    try {
        oaao_auth_ensure_pg_purpose_table($pdo);
    } catch (\Throwable) {
    }

    try {
        oaao_auth_ensure_pg_chat_endpoint_tables($pdo);
    } catch (\Throwable) {
    }

    try {
        oaao_auth_ensure_pg_conversation_workspace_column($pdo);
    } catch (\Throwable) {
    }

    try {
        oaao_auth_ensure_pg_workspace_tables($pdo);
    } catch (\Throwable) {
    }

    try {
        oaao_auth_ensure_pg_vault_workspace_and_jobs($pdo);
    } catch (\Throwable) {
    }

    try {
        oaao_auth_ensure_pg_vault_speaker_profiles($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensurePermissionGroupSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureTenantSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureNotificationSchema($pdo);
    } catch (\Throwable) {
    }

    OaaoAuthPgCoreBootstrapCache::markDone();
    require_once dirname(__DIR__) . '/../library/CrossProcessBootCache.php';
    OaaoAuthCrossProcessBootCache::markPgCoreBootDone();
};
