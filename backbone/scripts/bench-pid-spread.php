<?php

declare(strict_types=1);

/** @var list<int> */
$pids = [];
for ($i = 1; $i <= 30; $i++) {
    $body = @file_get_contents('http://127.0.0.1/auth/status');
    $json = is_string($body) ? json_decode($body, true) : null;
    $pid = null;
    if (is_array($json['bench'] ?? null)) {
        foreach ($json['bench'] as $m) {
            if (($m['label'] ?? '') === 'pid') {
                $pid = (int) $m['ms'];
            }
        }
    }
    $pids[] = $pid ?? -1;
    usleep(5000);
}
$uniq = array_count_values($pids);
ksort($uniq);
echo 'unique workers: ' . count($uniq) . PHP_EOL;
foreach ($uniq as $pid => $n) {
    echo "pid {$pid}: {$n} requests\n";
}
