<?php

declare(strict_types=1);

/** PostgreSQL storage DDL shim ({@see auth} {@code ensurePgStorageSchema}). */
return function (\PDO $pdo): void {
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    try {
        $this->ensureStorageSchema($pdo);
    } catch (\Throwable) {
    }
};
