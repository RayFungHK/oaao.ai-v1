<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;

/**
 * GET /research/api/watch_list
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    try {
        $repo = new ResearchRepository($ctx['db']);
        $watches = $repo->listWatchesForUser($ctx['tenant_id'], $ctx['uid']);
        $out = [];
        foreach ($watches as $w) {
            if (! \is_array($w)) {
                continue;
            }
            $wid = (int) ($w['watch_id'] ?? 0);
            $sources = $wid > 0 ? $repo->listSources($wid) : [];
            $lastRun = $wid > 0 ? $repo->getLatestRun($wid) : null;
            $w['sources'] = $sources;
            $w['last_run'] = $lastRun;
            $w['queue_status'] = $wid > 0 ? $repo->getFetchQueueStatus($wid) : null;
            if ($lastRun !== null && isset($lastRun['stats_json']) && \is_string($lastRun['stats_json'])) {
                try {
                    $decoded = json_decode($lastRun['stats_json'], true, 512, JSON_THROW_ON_ERROR);
                    $w['last_stats'] = \is_array($decoded) ? $decoded : null;
                } catch (\JsonException) {
                    $w['last_stats'] = null;
                }
            }
            $out[] = $w;
        }

        echo json_encode(['success' => true, 'watches' => $out], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not load watches.',
            'error'   => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE);
    }
};
