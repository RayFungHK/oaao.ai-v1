<?php

declare(strict_types=1);

/**
 * Shared PDO bootstrap for endpoints export/import CLI tools.
 *
 * Reads config/oaaoai/auth.php (same as oaao-auth-reset-password.php).
 */

/**
 * @return array<string, mixed>
 */
function oaao_endpoints_cli_load_config(string $configPath): array
{
    if (! is_file($configPath)) {
        throw new RuntimeException("Missing config: {$configPath}");
    }

    /** @var mixed $config */
    $config = require $configPath;
    if (! \is_array($config)) {
        throw new RuntimeException('Invalid auth config array');
    }

    return $config;
}

function oaao_endpoints_cli_connect(array $config): PDO
{
    $dbCfg = $config['database'] ?? [];
    if (! \is_array($dbCfg)) {
        throw new RuntimeException('Invalid database config');
    }

    $driver = (string) ($dbCfg['driver'] ?? 'sqlite');
    if ($driver === 'pgsql') {
        $pdo = new PDO(
            sprintf(
                'pgsql:host=%s;port=%d;dbname=%s',
                $dbCfg['host'] ?? 'localhost',
                (int) ($dbCfg['port'] ?? 5432),
                $dbCfg['database'] ?? ''
            ),
            (string) ($dbCfg['username'] ?? ''),
            (string) ($dbCfg['password'] ?? ''),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    } else {
        $path = (string) ($dbCfg['database'] ?? ':memory:');
        $pdo = new PDO(
            'sqlite:' . $path,
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    }

    return $pdo;
}

function oaao_endpoints_cli_prefix(array $config): string
{
    $dbCfg = $config['database'] ?? [];
    if (! \is_array($dbCfg)) {
        return 'oaao_';
    }

    $prefix = (string) ($dbCfg['prefix'] ?? 'oaao_');

    return $prefix !== '' ? $prefix : 'oaao_';
}

function oaao_endpoints_cli_print_usage(string $script, string $mode = 'export'): void
{
    if ($mode === 'import') {
        fwrite(STDERR, <<<TXT
Usage:
  php {$script} --in=PATH [--dry-run] [--config=PATH] [--tenant-id=N]
  php {$script} -i PATH [--dry-run] [--config=PATH] [--tenant-id=N]

Reads canonical DB settings from config/oaaoai/auth.php (override with --config).
Imports endpoints + purposes from JSON (natural keys: name, purpose_key).
Purposes require PostgreSQL; ensure api_key_ref env names exist in the target env.

Docker examples:
  docker compose cp ./endpoints-backup.json web:/tmp/endpoints.json
  docker compose exec web php /var/www/html/scripts/oaao_endpoints_import.php \\
    --in=/tmp/endpoints.json
  docker compose exec web php /var/www/html/scripts/oaao_endpoints_import.php \\
    --in=/tmp/endpoints.json --dry-run

TXT);
        return;
    }

    fwrite(STDERR, <<<TXT
Usage:
  php {$script} --out=PATH [--pretty] [--config=PATH] [--tenant-id=N]
  php {$script} -o PATH [--pretty] [--config=PATH] [--tenant-id=N]

Reads canonical DB settings from config/oaaoai/auth.php (override with --config).
Exports endpoints + purposes as JSON (natural keys: name, purpose_key).
Each row may include tenant_id when scoped to a tenant; import preserves it unless --tenant-id is set.
Purposes require PostgreSQL; api_key_ref names are exported, not secret values.

Docker examples:
  docker compose exec web php /var/www/html/scripts/oaao_endpoints_export.php \\
    --out=/tmp/endpoints.json --pretty
  docker compose cp web:/tmp/endpoints.json ./endpoints-backup.json

TXT);
}
