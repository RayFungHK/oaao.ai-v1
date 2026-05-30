<?php

declare(strict_types=1);

/** {@code oaao_chat_endpoint*} on canonical driver ({@see auth} {@code ensureChatEndpointTables}). */
return function (\Razy\Database $database): void {
    $pdo = $database->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        return;
    }

    if (($database->getDriverType() ?? '') === 'pgsql') {
        require_once __DIR__ . '/_install_pg_core_schema.php';
        oaao_auth_ensure_pg_chat_endpoint_tables($pdo);

        return;
    }

    require_once __DIR__ . '/_install_sqlite_schema.php';
    oaao_auth_ensure_sqlite_chat_endpoint_tables($pdo);
};
