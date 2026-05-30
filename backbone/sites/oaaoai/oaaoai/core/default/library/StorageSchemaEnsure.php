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

        AuthSchemaBridge::ensurePgStorageSchema($pdo);
        AuthSchemaBridge::ensureTenantSchema($pdo);
    }
}
