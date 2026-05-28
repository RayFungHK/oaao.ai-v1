#!/usr/bin/env php
<?php

/**
 * Export oaao_endpoint + oaao_purpose settings to JSON for copying to another environment.
 *
 * Usage:
 *   php scripts/oaao_endpoints_export.php --out=endpoints-backup.json [--pretty]
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/oaao_endpoints_cli_bootstrap.php';
require_once __DIR__ . '/../sites/oaaoai/oaaoai/endpoints/default/library/EndpointsConfigTransfer.php';

use oaaoai\endpoints\EndpointsConfigTransfer;

$opts = getopt('o:', ['out:', 'pretty', 'config:', 'tenant-id:', 'help']);
if ($opts === false || isset($opts['help'])) {
    oaao_endpoints_cli_print_usage(basename(__FILE__), 'export');
    exit(isset($opts['help']) ? 0 : 1);
}

$outPath = trim((string) ($opts['out'] ?? $opts['o'] ?? ''));
if ($outPath === '') {
    fwrite(STDERR, "Error: --out=PATH is required\n");
    exit(1);
}

$configPath = trim((string) ($opts['config'] ?? ''));
if ($configPath === '') {
    $configPath = dirname(__DIR__) . '/config/oaaoai/auth.php';
}

$tenantId = isset($opts['tenant-id']) ? max(0, (int) $opts['tenant-id']) : 0;
$pretty = isset($opts['pretty']);

try {
    $config = oaao_endpoints_cli_load_config($configPath);
    $pdo = oaao_endpoints_cli_connect($config);
    $prefix = oaao_endpoints_cli_prefix($config);

    $transfer = new EndpointsConfigTransfer($pdo, $prefix, $tenantId);
    $bundle = $transfer->export();

    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
    if ($pretty) {
        $flags |= JSON_PRETTY_PRINT;
    }
    $json = json_encode($bundle, $flags);

    if (str_starts_with($outPath, '-')) {
        echo $json, PHP_EOL;
    } else {
        if (file_put_contents($outPath, $json . PHP_EOL) === false) {
            throw new RuntimeException("Cannot write {$outPath}");
        }
        $ep = \count($bundle['endpoints'] ?? []);
        $pu = \count($bundle['purposes'] ?? []);
        echo "Exported {$ep} endpoint(s) and {$pu} purpose(s) to {$outPath}\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
