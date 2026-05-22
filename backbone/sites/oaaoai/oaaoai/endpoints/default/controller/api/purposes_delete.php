<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * POST /endpoints/api/purposes_delete — delete {@code oaao_purpose} by id.
 *
 * Body JSON: { "id": number }
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    if (! $this->oaao_endpoints_canonical_is_pgsql($db)) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Purposes are stored on the PostgreSQL canonical database only. Switch auth database.driver to pgsql.',
        ]);

        return;
    }

    require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    $input = json_decode((string) file_get_contents('php://input'), true);
    $id = is_array($input) ? (int) ($input['id'] ?? 0) : 0;
    if ($id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid id']);

        return;
    }

    try {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $affected = $repo->deletePurposeById($id);
        if ($affected < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Purpose not found']);

            return;
        }

        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to delete purpose']);
    }
};
