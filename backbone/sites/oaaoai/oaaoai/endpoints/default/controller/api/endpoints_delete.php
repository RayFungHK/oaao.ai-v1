<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * POST /endpoints/api/endpoints_delete — delete {@code oaao_endpoint} by id.
 *
 * Body JSON: { "id": number }
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    $id = is_array($input) ? (int) ($input['id'] ?? 0) : 0;
    if ($id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid id']);

        return;
    }

    try {
        $repo = new CanonicalEndpointsRepository($db);
        $affected = $repo->deleteEndpointById($id);
        if ($affected < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Endpoint not found']);

            return;
        }

        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to delete endpoint']);
    }
};
