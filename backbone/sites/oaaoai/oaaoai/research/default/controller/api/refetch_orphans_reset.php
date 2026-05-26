<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/refetch_orphans_reset — internal: re-queue stuck refetch rows (orchestrator startup).
 *
 * Body: {@code max_age_sec} optional — 0 resets all running; default 120.
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
        $input = [];
    }

    $maxAgeSec = isset($input['max_age_sec']) ? (int) $input['max_age_sec'] : 120;

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
    $reset = $repo->resetOrphanRefetchItems($maxAgeSec);

    echo json_encode([
        'success' => true,
        'reset'   => $reset,
        'refetch' => $repo->countAllRefetchItems(),
    ], JSON_UNESCAPED_UNICODE);
};
