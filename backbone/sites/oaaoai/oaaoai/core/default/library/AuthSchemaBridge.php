<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Core libraries call auth-owned DDL through registered callables (set from {@code oaaoai/auth} {@code __onReady}).
 * Avoids {@code require_once} of auth controller paths from core {@see TenantRepository} / {@see UsageEventRepository}.
 */
final class AuthSchemaBridge
{
    /** @var callable(\PDO): void|null */
    private static $ensureTenantSchema = null;

    /** @var callable(\PDO): void|null */
    private static $ensurePermissionGroupSchema = null;

    /** @var callable(\PDO): void|null */
    private static $ensurePgStorageSchema = null;

    /** @param callable(\PDO): void $fn */
    public static function setEnsureTenantSchema(callable $fn): void
    {
        self::$ensureTenantSchema = $fn;
    }

    /** @param callable(\PDO): void $fn */
    public static function setEnsurePermissionGroupSchema(callable $fn): void
    {
        self::$ensurePermissionGroupSchema = $fn;
    }

    public static function ensureTenantSchema(\PDO $pdo): void
    {
        if (self::$ensureTenantSchema !== null) {
            (self::$ensureTenantSchema)($pdo);

            return;
        }
    }

    /** @param callable(\PDO): void $fn */
    public static function setEnsurePgStorageSchema(callable $fn): void
    {
        self::$ensurePgStorageSchema = $fn;
    }

    public static function ensurePgStorageSchema(\PDO $pdo): void
    {
        if (self::$ensurePgStorageSchema !== null) {
            (self::$ensurePgStorageSchema)($pdo);
        }
    }

    public static function ensurePermissionGroupSchema(\PDO $pdo): void
    {
        if (self::$ensurePermissionGroupSchema !== null) {
            (self::$ensurePermissionGroupSchema)($pdo);
        }
    }
}
