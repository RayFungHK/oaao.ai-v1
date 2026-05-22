<?php

/**
 * Force first-run install wizard by setting installed => false in config/oaaoai/auth.php.
 *
 * CLI only. Docker example:
 *
 *   docker compose exec web php /var/www/html/scripts/oaao-auth-reset-install.php
 *
 * PostgreSQL / adjunct SQLite files are NOT deleted. If an admin row already exists,
 * POST /auth/install/save may UPDATE it or refuse duplicate paths — use reset-password or drop DB for a truly empty slate.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Forbidden');
}

$configPath = dirname(__DIR__) . '/config/oaaoai/auth.php';
if (! is_file($configPath)) {
    fwrite(STDERR, "Error: missing {$configPath}\n");

    exit(1);
}

$content = file_get_contents($configPath);
if ($content === false) {
    fwrite(STDERR, "Error: cannot read {$configPath}\n");

    exit(1);
}

if (! preg_match("/'installed'\\s*=>\\s*(true|false)\\s*,/", $content, $m)) {
    fwrite(STDERR, "Error: could not find 'installed' => true|false in auth.php.\n");

    exit(1);
}

if ($m[1] === 'false') {
    echo "Already first-run mode (installed => false). No change.\n";

    exit(0);
}

$new = preg_replace("/'installed'\\s*=>\\s*true\\s*,/", "'installed' => false,", $content, 1);
if ($new === null || $new === $content) {
    fwrite(STDERR, "Error: failed to toggle installed flag.\n");

    exit(1);
}

if (file_put_contents($configPath, $new) === false) {
    fwrite(STDERR, "Error: cannot write {$configPath} (permissions?).\n");

    exit(1);
}

if (function_exists('opcache_invalidate')) {
    @opcache_invalidate($configPath, true);
}

echo "Set installed => false. Reload the site to open the install wizard.\n";
echo "Tip: postgres data is unchanged; to wipe it, stop containers and remove your PG data dir (see docker/env.example).\n";
