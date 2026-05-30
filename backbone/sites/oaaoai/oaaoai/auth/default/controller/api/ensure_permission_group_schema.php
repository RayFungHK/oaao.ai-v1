<?php

declare(strict_types=1);

/** Permission group columns on {@code oaao_group} / {@code oaao_user} ({@see auth} {@code ensurePermissionGroupSchema}). */
return function (\PDO $pdo): void {
    $driver = $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME);

    if ($driver === 'pgsql') {
        try {
            $pdo->exec('ALTER TABLE oaao_group ADD COLUMN permissions_json TEXT DEFAULT NULL');
        } catch (\Throwable) {
        }
        try {
            $pdo->exec('ALTER TABLE oaao_group ADD COLUMN limits_json TEXT DEFAULT NULL');
        } catch (\Throwable) {
        }
        try {
            $pdo->exec('ALTER TABLE oaao_group ADD COLUMN disabled SMALLINT NOT NULL DEFAULT 0');
        } catch (\Throwable) {
        }
        try {
            $pdo->exec('ALTER TABLE oaao_user ADD COLUMN permission_group_id BIGINT DEFAULT NULL');
        } catch (\Throwable) {
        }

        return;
    }

    if ($driver !== 'sqlite') {
        return;
    }

    $ensureCol = static function (\PDO $pdo, string $table, string $col, string $ddl): void {
        try {
            $cols = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable) {
            return;
        }
        foreach ($cols as $c) {
            if (strtolower((string) ($c['name'] ?? '')) === strtolower($col)) {
                return;
            }
        }
        try {
            $pdo->exec($ddl);
        } catch (\Throwable) {
        }
    };

    $ensureCol($pdo, 'oaao_group', 'permissions_json', 'ALTER TABLE oaao_group ADD COLUMN permissions_json TEXT DEFAULT NULL');
    $ensureCol($pdo, 'oaao_group', 'limits_json', 'ALTER TABLE oaao_group ADD COLUMN limits_json TEXT DEFAULT NULL');
    $ensureCol($pdo, 'oaao_group', 'disabled', 'ALTER TABLE oaao_group ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
    $ensureCol($pdo, 'oaao_user', 'permission_group_id', 'ALTER TABLE oaao_user ADD COLUMN permission_group_id INTEGER DEFAULT NULL');
};
