<?php

/**
 * GET /auth/bench-probe — dev timing breakdown (requires OAAO_BENCH_PROBE=1).
 */
return function (): void {
    if (strtolower(trim((string) getenv('OAAO_BENCH_PROBE'))) !== '1') {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Not found']);

        return;
    }

    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    $marks = $GLOBALS['oaao_bench_marks'] ?? [];

    echo json_encode([
        'success' => true,
        'marks'   => $marks,
        'totals'  => [
            'request_float' => isset($_SERVER['REQUEST_TIME_FLOAT'])
                ? round((microtime(true) - (float) $_SERVER['REQUEST_TIME_FLOAT']) * 1000)
                : null,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
