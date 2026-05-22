<?php

use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * GET /endpoints/api/endpoints_list — administrator-only list of {@code oaao_endpoint} rows.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    try {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $rows = $repo->listEndpoints();
        echo json_encode(['success' => true, 'endpoints' => $rows ?: []], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load endpoints']);
    }
};
