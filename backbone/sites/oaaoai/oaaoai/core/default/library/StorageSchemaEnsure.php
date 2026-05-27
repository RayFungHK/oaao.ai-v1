<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/** Idempotent PostgreSQL DDL for per-tenant object storage (runs even when PG bootstrap cache is hot). */
final class StorageSchemaEnsure
{
    public static function ensure(\PDO $pdo): void
    {
        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return;
        }

        require_once dirname(__DIR__, 3) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_storage_schema($pdo);
        AuthSchemaBridge::ensureTenantSchema($pdo);
    }
}
