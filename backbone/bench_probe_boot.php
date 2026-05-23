<?php

declare(strict_types=1);

if (getenv('OAAO_BENCH_PROBE') === '1') {
    require_once __DIR__ . '/sites/oaaoai/oaaoai/core/default/library/BenchProbe.php';
    OaaoBenchProbe::boot();
}
