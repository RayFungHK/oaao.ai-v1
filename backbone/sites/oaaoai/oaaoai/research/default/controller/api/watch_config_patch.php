<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/watch_config_patch — internal: merge fields into watch config_json.
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

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    $patch = isset($input['patch']) && \is_array($input['patch']) ? $input['patch'] : [];
    if ($watchId < 1 || $patch === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id and patch required']);

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
    $repo->patchWatchConfig($watchId, $patch);

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
