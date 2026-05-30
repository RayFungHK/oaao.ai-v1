<?php

declare(strict_types=1);

/**
 * Legacy procedural entry — prefer {@code api('chat')->ensureChatProfileTables($database)}.
 *
 * @see api/ensure_chat_profile_tables.php Razy closure (bound via chat {@code addAPICommand})
 */
function oaao_chat_ensure_profile_tables(\Razy\Database $database): void
{
    /** @var \Closure(\Razy\Database): void|null $ensure */
    static $ensure = null;
    if ($ensure === null) {
        $loaded = require __DIR__ . '/ensure_chat_profile_tables.php';
        if (! $loaded instanceof \Closure) {
            throw new \RuntimeException('ensure_chat_profile_tables.php must return a Closure');
        }
        $ensure = $loaded;
    }
    // Legacy callers have no Controller — delegate to auth-owned endpoint tables directly.
    $pdo = $database->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        return;
    }
    if (($database->getDriverType() ?? '') === 'pgsql') {
        require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_install_pg_core_schema.php';
        oaao_auth_ensure_pg_chat_endpoint_tables($pdo);

        return;
    }
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_install_sqlite_schema.php';
    oaao_auth_ensure_sqlite_chat_endpoint_tables($pdo);
}
