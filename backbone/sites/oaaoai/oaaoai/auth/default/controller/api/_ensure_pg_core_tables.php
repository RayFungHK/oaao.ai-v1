<?php

/**
 * Idempotent PostgreSQL bootstrap for oaao_* core tables (oaao_user, …).
 *
 * Callable from {@see auth::__onReady}, login/register, or session resolution when
 * Docker/__onReady ordering or swallowed exceptions would otherwise skip DDL.
 *
 * Uses {@see MigrationManager} without migration paths — avoids getMigrationManager()
 * throwing when auth/default/migration/ is absent from the image.
 *
 * No request-static cache: {@see \Razy\Database::GetInstance} survives across PHP-FPM
 * requests on the same worker; caching by spl_object_id caused permanent skips after a
 * mistaken non-pgsql classification or stale state.
 */

declare(strict_types=1);

function oaao_auth_database_is_pgsql(\Razy\Database $database): bool
{
    if (($database->getDriverType() ?? '') === 'pgsql') {
        return true;
    }
    $pdo = $database->getDBAdapter();

    return $pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';
}

function oaao_auth_ensure_pg_core_tables(\Razy\Database $database): void
{
    if (! oaao_auth_database_is_pgsql($database)) {
        return;
    }

    $pdo = $database->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        return;
    }

    require_once __DIR__ . '/_install_pg_core_schema.php';

    $tracking = new \Razy\Database\MigrationManager($database);
    $tracking->ensureTrackingTable();

    $hasUser = false;
    try {
        // Tables visible on the session search_path (avoids current_schema-only mismatches).
        $existsStmt = $pdo->query(
            'SELECT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_tables t
                WHERE t.tablename = \'oaao_user\'
                  AND t.schemaname = ANY (SELECT unnest(current_schemas(false)))
            )'
        );
        $hasUser = $existsStmt && (bool) $existsStmt->fetchColumn();
    } catch (\Throwable) {
        $hasUser = false;
    }

    if (! $hasUser) {
        oaao_auth_install_pg_core_schema($pdo);
        oaao_auth_seed_pg_migration_rows($pdo);
    }

    // Same connection must resolve unqualified oaao_user as the ORM does (catches search_path / visibility mismatches).
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
        // Best-effort — endpoints module surfaces actionable errors if DDL failed.
    }

    try {
        oaao_auth_ensure_pg_chat_endpoint_tables($pdo);
    } catch (\Throwable) {
        // Best-effort — chat admin APIs surface actionable errors if DDL failed.
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
        require_once __DIR__ . '/_ensure_permission_group_schema.php';
        oaao_auth_ensure_permission_group_schema($pdo);
    } catch (\Throwable) {
    }

    try {
        require_once __DIR__ . '/_ensure_tenant_schema.php';
        oaao_auth_ensure_tenant_schema($pdo);
    } catch (\Throwable) {
    }
}
