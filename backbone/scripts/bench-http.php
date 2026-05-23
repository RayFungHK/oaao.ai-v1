<?php

declare(strict_types=1);

/**
 * CLI: measure in-container HTTP latency (bypasses host Docker Desktop port forwarding).
 * Usage: php scripts/bench-http.php [/auth/status] [iterations]
 */

$path = $argv[1] ?? '/auth/status';
$n = max(1, (int) ($argv[2] ?? 15));
$url = 'http://127.0.0.1' . $path;

$times = [];
for ($i = 1; $i <= $n; $i++) {
    $t0 = microtime(true);
    $body = @file_get_contents($url);
    $ms = (int) round((microtime(true) - $t0) * 1000);
    $times[] = $ms;
    $bench = null;
    if ($body !== false) {
        $json = json_decode($body, true);
        $bench = $json['bench'] ?? null;
    }
    echo "req {$i}: {$ms}ms";
    if (is_array($bench) && $bench !== []) {
        echo ' bench=';
        foreach ($bench as $m) {
            echo $m['label'] . ':' . $m['delta'] . 'ms ';
        }
    }
    echo "\n";
}

sort($times);
$avg = array_sum($times) / count($times);
echo sprintf(
    "avg=%.1fms min=%d max=%d p50=%d\n",
    $avg,
    min($times),
    max($times),
    $times[(int) floor(count($times) / 2)]
);
