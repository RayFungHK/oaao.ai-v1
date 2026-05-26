<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;

/**
 * GET /research/api/fetch_queue_status?watch_id=
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $watchId = isset($_GET['watch_id']) ? (int) $_GET['watch_id'] : 0;
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

    $status = $repo->getFetchQueueStatus($watchId);

    echo json_encode([
        'success'   => true,
        'watch_id'  => $watchId,
        'status'    => $status,
    ], JSON_UNESCAPED_UNICODE);
};
