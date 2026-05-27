#!/usr/bin/env php
<?php
/**
 * W12-S2 follow-up — enumerate oaaoai JSON API closure paths for unified docs ingestion.
 *
 * Usage:
 *   php scripts/list_php_routes.php [--pretty]
 *
 * Output: JSON array of {module, route_prefix, method, path, handler}
 */
declare(strict_types=1);

$pretty = in_array('--pretty', $argv ?? [], true);
$root = dirname(__DIR__) . '/backbone/sites/oaaoai/oaaoai';
$routes = [];

if (! is_dir($root)) {
    fwrite(STDERR, "module root missing: {$root}\n");
    exit(1);
}

foreach (glob($root . '/*/default/controller/api/*.php') ?: [] as $file) {
    $base = basename($file, '.php');
    if ($base === '' || str_starts_with($base, '_')) {
        continue;
    }
    if (! preg_match('#/oaaoai/([^/]+)/default/controller/api/#', $file, $m)) {
        continue;
    }
    $module = 'oaaoai/' . $m[1];
    $prefix = '/' . $m[1] . '/api';
    $routes[] = [
        'module'        => $module,
        'route_prefix'  => $prefix,
        'method'        => 'GET|POST|PUT|DELETE',
        'path'          => $prefix . '/' . $base,
        'handler'       => 'controller/api/' . $base . '.php',
    ];
}

usort(
    $routes,
    static fn(array $a, array $b): int => [$a['module'], $a['path']] <=> [$b['module'], $b['path']],
);

$json = $pretty
    ? json_encode($routes, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
    : json_encode($routes, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

echo $json, PHP_EOL;
