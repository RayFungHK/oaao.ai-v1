<?php

declare(strict_types=1);

for ($i = 1; $i <= 12; $i++) {
    $j = json_decode((string) file_get_contents('http://127.0.0.1/auth/status'), true);
    $pid = '?';
    foreach ($j['bench'] ?? [] as $m) {
        if (($m['label'] ?? '') === 'pid') {
            $pid = (string) $m['ms'];
        }
    }
    echo "{$i} worker_hits=" . ($j['worker_hits'] ?? '?') . " pid={$pid}\n";
}
