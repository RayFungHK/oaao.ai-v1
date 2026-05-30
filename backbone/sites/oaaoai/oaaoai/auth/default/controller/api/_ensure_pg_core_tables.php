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
 * Per PHP-FPM worker cache: full bootstrap runs once per worker after a successful pass.
 * {@see oaao_auth_reset_pg_core_tables_cache()} after install/migrations that add ensure steps.
 *
 * Schema ensure closures use {@code #ensureXxx} on auth {@code addAPICommand} (API + internal bind).
 */

declare(strict_types=1);

/**
 * Per PHP-FPM / mod_php worker cache ({@code static} survives across requests in the same process).
 */
final class OaaoAuthPgCoreBootstrapCache
{
    private static bool $done = false;

    public static function isDone(): bool
    {
        return self::$done;
    }

    public static function markDone(): void
    {
        self::$done = true;
    }

    public static function reset(): void
    {
        self::$done = false;
    }
}

function oaao_auth_reset_pg_core_tables_cache(): void
{
    OaaoAuthPgCoreBootstrapCache::reset();
    require_once dirname(__DIR__) . '/../library/CrossProcessBootCache.php';
    OaaoAuthCrossProcessBootCache::resetAll();
}

function oaao_auth_database_is_pgsql(\Razy\Database $database): bool
{
    if (($database->getDriverType() ?? '') === 'pgsql') {
        return true;
    }
    $pdo = $database->getDBAdapter();

    return $pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';
}
