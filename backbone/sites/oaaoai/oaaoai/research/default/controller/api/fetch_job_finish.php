<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

/**
 * POST /research/api/fetch_job_finish — internal: mark research fetch job done/skipped/failed.
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

    $jobId = isset($input['job_id']) ? (int) $input['job_id'] : 0;
    $status = strtolower(trim((string) ($input['status'] ?? 'done')));
    if ($jobId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'job_id required']);

        return;
    }
    if (! \in_array($status, ['done', 'skipped', 'failed'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid status']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    $pdo = $db?->getDBAdapter();
    if (! ($pdo instanceof \PDO)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    $errorText = isset($input['error_text']) ? trim((string) $input['error_text']) : null;
    if ($errorText === '') {
        $errorText = null;
    }

    $st = $pdo->prepare(
        'UPDATE oaao_research_fetch_job
         SET status = :status,
             error_text = :error_text,
             finished_at = CURRENT_TIMESTAMP
         WHERE job_id = :job_id'
    );
    $st->execute([
        'status'     => $status,
        'error_text' => $errorText,
        'job_id'     => $jobId,
    ]);

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
