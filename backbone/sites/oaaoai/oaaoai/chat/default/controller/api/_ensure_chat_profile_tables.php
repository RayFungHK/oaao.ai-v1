<?php

declare(strict_types=1);

/**
 * Ensures {@code oaao_chat_endpoint*} exist on the canonical driver (PostgreSQL or SQLite core file).
 */
function oaao_chat_ensure_profile_tables(\Razy\Database $database): void
{
    $pdo = $database->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        return;
    }

    if (($database->getDriverType() ?? '') === 'pgsql') {
        require_once __DIR__ . '/../../../../auth/default/controller/api/_install_pg_core_schema.php';
        oaao_auth_ensure_pg_chat_endpoint_tables($pdo);

        return;
    }

    require_once __DIR__ . '/../../../../auth/default/controller/api/_install_sqlite_schema.php';
    oaao_auth_ensure_sqlite_chat_endpoint_tables($pdo);
}
