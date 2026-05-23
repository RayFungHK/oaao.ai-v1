<?php

declare(strict_types=1);

/**
 * CLI: opcache + include stat probe (same bind-mount as Apache).
 * Usage: php scripts/bench-opcache-stat.php
 */

$root = dirname(__DIR__);
$files = [
    $root . '/index.php',
    $root . '/sites/oaaoai/oaaoai/auth/default/controller/auth.php',
    $root . '/sites/oaaoai/oaaoai/auth/default/controller/api/_ensure_pg_core_tables.php',
    $root . '/sites/oaaoai/oaaoai/auth/default/controller/api/status.php',
    $root . '/Razy.phar',
];

echo 'opcache.validate_timestamps=' . ini_get('opcache.validate_timestamps') . PHP_EOL;
echo 'opcache.enable=' . ini_get('opcache.enable') . PHP_EOL;

if (function_exists('opcache_get_status')) {
    $st = opcache_get_status(false);
    if (is_array($st)) {
        echo 'opcache.cached_scripts=' . ($st['opcache_statistics']['num_cached_scripts'] ?? '?') . PHP_EOL;
        echo 'opcache.hits=' . ($st['opcache_statistics']['hits'] ?? '?') . PHP_EOL;
        echo 'opcache.misses=' . ($st['opcache_statistics']['misses'] ?? '?') . PHP_EOL;
    }
}

$t0 = microtime(true);
for ($i = 0; $i < 500; $i++) {
    foreach ($files as $f) {
        clearstatcache(true, $f);
        is_file($f);
        filemtime($f);
    }
}
$statMs = (int) round((microtime(true) - $t0) * 1000);
echo "500x stat loop (5 files): {$statMs}ms" . PHP_EOL;

$t0 = microtime(true);
for ($i = 0; $i < 10; $i++) {
    @Phar::loadPhar($root . '/Razy.phar', 'Razy.phar');
}
$pharMs = (int) round((microtime(true) - $t0) * 1000);
echo "10x Phar::loadPhar: {$pharMs}ms" . PHP_EOL;
