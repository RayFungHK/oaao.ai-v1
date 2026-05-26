<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;

/**
 * GET /mine/api/mine_list
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    try {
        $repo = new MineRepository($ctx['db']);
        $mines = $repo->listMinesForUser($ctx['tenant_id'], $ctx['uid']);
        $out = [];
        foreach ($mines as $m) {
            if (! \is_array($m)) {
                continue;
            }
            $mid = (int) ($m['mine_id'] ?? 0);
            $sources = $mid > 0 ? $repo->listSources($mid) : [];
            $lastRun = $mid > 0 ? $repo->getLatestRun($mid) : null;
            $m['sources'] = $sources;
            $m['last_run'] = $lastRun;
            if ($lastRun !== null && isset($lastRun['stats_json']) && \is_string($lastRun['stats_json'])) {
                try {
                    $m['last_stats'] = json_decode($lastRun['stats_json'], true, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $m['last_stats'] = null;
                }
            }
            $out[] = $m;
        }

        echo json_encode(['success' => true, 'mines' => $out], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not load mines.',
            'error'   => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE);
    }
};
