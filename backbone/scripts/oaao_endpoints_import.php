#!/usr/bin/env php
<?php

/**
 * Import oaao_endpoint + oaao_purpose settings from JSON (see oaao_endpoints_export.php).
 *
 * Usage:
 *   php scripts/oaao_endpoints_import.php --in=endpoints-backup.json [--dry-run]
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/oaao_endpoints_cli_bootstrap.php';
require_once __DIR__ . '/../sites/oaaoai/oaaoai/endpoints/default/library/EndpointsConfigTransfer.php';

use oaaoai\endpoints\EndpointsConfigTransfer;

$opts = getopt('i:', ['in:', 'dry-run', 'config:', 'tenant-id:', 'help']);
if ($opts === false || isset($opts['help'])) {
    oaao_endpoints_cli_print_usage(basename(__FILE__), 'import');
    exit(isset($opts['help']) ? 0 : 1);
}

$inPath = trim((string) ($opts['in'] ?? $opts['i'] ?? ''));
if ($inPath === '') {
    fwrite(STDERR, "Error: --in=PATH is required\n");
    exit(1);
}

$configPath = trim((string) ($opts['config'] ?? ''));
if ($configPath === '') {
    $configPath = dirname(__DIR__) . '/config/oaaoai/auth.php';
}

$tenantId = isset($opts['tenant-id']) ? max(0, (int) $opts['tenant-id']) : 0;
$dryRun = isset($opts['dry-run']);

try {
    if (! is_file($inPath)) {
        throw new RuntimeException("Input file not found: {$inPath}");
    }
    $raw = file_get_contents($inPath);
    if ($raw === false) {
        throw new RuntimeException("Cannot read {$inPath}");
    }
    /** @var mixed $bundle */
    $bundle = json_decode($raw, true);
    if (! \is_array($bundle)) {
        throw new RuntimeException('Invalid JSON bundle');
    }

    $config = oaao_endpoints_cli_load_config($configPath);
    $pdo = oaao_endpoints_cli_connect($config);
    $prefix = oaao_endpoints_cli_prefix($config);

    $transfer = new EndpointsConfigTransfer($pdo, $prefix, $tenantId);
    $result = $transfer->import($bundle, $dryRun);

    $mode = $dryRun ? 'Dry-run' : 'Import';
    echo "{$mode} complete:\n";
    echo "  endpoints created: {$result['endpoints_created']}\n";
    echo "  endpoints updated: {$result['endpoints_updated']}\n";
    echo "  purposes created:  {$result['purposes_created']}\n";
    echo "  purposes updated:  {$result['purposes_updated']}\n";
    foreach ($result['warnings'] as $warning) {
        echo "  warning: {$warning}\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
