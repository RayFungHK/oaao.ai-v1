<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/fetch_job_enqueue — internal: queue article fetch jobs for a run.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $runId = isset($input['run_id']) ? (int) $input['run_id'] : 0;
    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    $jobs = isset($input['jobs']) && \is_array($input['jobs']) ? $input['jobs'] : [];
    if ($runId < 1 || $watchId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'run_id and watch_id required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    $repo = new ResearchRepository($db);
    $queued = $repo->enqueueFetchJobs($runId, $watchId, $jobs);

    echo json_encode(['success' => true, 'queued' => $queued], JSON_UNESCAPED_UNICODE);
};
