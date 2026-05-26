<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/refetch_item_finish — internal: mark refetch item done/failed.
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

    $itemId = isset($input['item_id']) ? (int) $input['item_id'] : 0;
    $status = trim((string) ($input['status'] ?? ''));
    if ($itemId < 1 || ! \in_array($status, ['done', 'failed'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'item_id and status required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    $repo = new ResearchRepository($db);
    $errorText = isset($input['error_text']) ? trim((string) $input['error_text']) : null;
    $repo->finishRefetchItem($itemId, $status, $errorText);

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
