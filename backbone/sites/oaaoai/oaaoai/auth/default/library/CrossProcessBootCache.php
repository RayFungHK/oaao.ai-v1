<?php

declare(strict_types=1);

/**
 * Cross-process boot flags (Apache prefork = fresh PHP per request; method-static does not survive).
 * APCu when available, else sentinel files under auth/data.
 */
final class OaaoAuthCrossProcessBootCache
{
    private const APCU_PG = 'oaao_auth_pg_core_boot_v1';

    private const APCU_WORKER = 'oaao_auth_worker_ready_v1';

    public static function pgCoreBootDone(): bool
    {
        if (function_exists('apcu_fetch')) {
            $v = apcu_fetch(self::APCU_PG);
            if ($v === true) {
                return true;
            }
        }

        $path = self::sentinelPath('pg_core_boot');
        if ($path !== null && is_file($path)) {
            if (function_exists('apcu_store')) {
                @apcu_store(self::APCU_PG, true, 86400);
            }

            return true;
        }

        return false;
    }

    public static function markPgCoreBootDone(): void
    {
        if (function_exists('apcu_store')) {
            @apcu_store(self::APCU_PG, true, 86400);
        }
        $path = self::sentinelPath('pg_core_boot');
        if ($path !== null) {
            @file_put_contents($path, (string) time());
        }
    }

    public static function workerReady(): bool
    {
        if (function_exists('apcu_fetch')) {
            $v = apcu_fetch(self::APCU_WORKER);
            if ($v === true) {
                return true;
            }
        }

        $path = self::sentinelPath('worker_ready');
        if ($path !== null && is_file($path)) {
            if (function_exists('apcu_store')) {
                @apcu_store(self::APCU_WORKER, true, 86400);
            }

            return true;
        }

        return false;
    }

    public static function markWorkerReady(): void
    {
        if (function_exists('apcu_store')) {
            @apcu_store(self::APCU_WORKER, true, 86400);
        }
        $path = self::sentinelPath('worker_ready');
        if ($path !== null) {
            @file_put_contents($path, (string) time());
        }
    }

    public static function resetAll(): void
    {
        if (function_exists('apcu_delete')) {
            @apcu_delete(self::APCU_PG);
            @apcu_delete(self::APCU_WORKER);
        }
        foreach (['pg_core_boot', 'worker_ready'] as $name) {
            $path = self::sentinelPath($name);
            if ($path !== null && is_file($path)) {
                @unlink($path);
            }
        }
    }

    private static function sentinelPath(string $name): ?string
    {
        $env = getenv('OAAO_AUTH_BOOT_CACHE_DIR');
        if ($env !== false && trim((string) $env) !== '') {
            $dir = trim((string) $env);
        } else {
            $dir = dirname(__DIR__, 2) . '/data';
        }
        if ($dir === '') {
            return null;
        }

        return $dir . '/.oaao_' . $name . '.ok';
    }
}
