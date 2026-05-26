<?php

use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * GET /endpoints/api/purposes_list — list {@code oaao_purpose} (PostgreSQL canonical only).
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    if (! $this->oaao_endpoints_canonical_is_pgsql($db)) {
        echo json_encode(
            [
                'success'                  => true,
                'purposes'                 => [],
                'purposes_postgresql_only' => true,
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );

        return;
    }

    require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    try {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $repo->ensurePlanningPurposeRow();
        $repo->ensureAsrLivePurposeRow();
        $rows = $repo->listPurposesWithDefaultEndpointName();
        echo json_encode(
            ['success' => true, 'purposes' => $rows ?: [], 'purposes_postgresql_only' => false],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );
    } catch (\Throwable $e) {
        error_log(sprintf('[purposes_list] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load purposes']);
    }
};
