<?php

declare(strict_types=1);

header('Content-Type: application/json');
$st = function_exists('opcache_get_status') ? opcache_get_status(false) : false;
$stats = is_array($st) ? ($st['opcache_statistics'] ?? []) : [];
echo json_encode([
    'validate_timestamps' => ini_get('opcache.validate_timestamps'),
    'cached_scripts'      => $stats['num_cached_scripts'] ?? null,
    'hits'                => $stats['hits'] ?? null,
    'misses'              => $stats['misses'] ?? null,
    'hit_rate'            => isset($stats['hits'], $stats['misses'])
        ? round(100 * ($stats['hits'] / max(1, $stats['hits'] + $stats['misses'])), 2)
        : null,
    'pid'                 => getmypid(),
], JSON_PRETTY_PRINT);
