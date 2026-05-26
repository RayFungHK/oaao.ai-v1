<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/refetch_all — mark all stored articles for background refetch (one-at-a-time worker).
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    if ($watchId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id required']);

        return;
    }

    $repo = new ResearchRepository($ctx['db']);
    $watch = $repo->getWatch($watchId, $ctx['tenant_id'], $ctx['uid']);
    if ($watch === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Watch not found']);

        return;
    }

    $repo->clearQueuedFetchJobs($watchId);
    $queued = $repo->markAllItemsNeedRefetch($watchId);
    $refetch = $repo->countRefetchItems($watchId);

    $runId = $repo->insertRun([
        'watch_id'   => $watchId,
        'status'     => 'done',
        'stats_json' => json_encode([
            'refetch_queued' => $queued,
            'refetch_pending'=> $refetch['queued'] + $refetch['running'],
            'mode'           => 'background_refetch',
        ], JSON_UNESCAPED_UNICODE),
        'started_at' => gmdate('Y-m-d H:i:s'),
        'finished_at'=> gmdate('Y-m-d H:i:s'),
        'created_at' => gmdate('Y-m-d H:i:s'),
    ]);

    echo json_encode([
        'success' => true,
        'run_id'  => $runId,
        'refetch' => true,
        'stats'   => [
            'refetch_queued'  => $queued,
            'refetch_pending' => $refetch['queued'] + $refetch['running'],
            'refetch'         => $refetch,
            'queued'          => $refetch['queued'],
            'processed'       => 0,
            'planned'         => $queued,
        ],
        'message' => $queued > 0
            ? "{$queued} article(s) queued for background refetch"
            : 'No stored articles to refetch',
    ], JSON_UNESCAPED_UNICODE);
};
