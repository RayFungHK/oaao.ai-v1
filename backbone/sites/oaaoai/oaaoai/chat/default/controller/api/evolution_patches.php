<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /chat/api/evolution_patches — administrator: evolution patch review queue.
 * POST body { "action": "approve"|"rollback", "patch_id": "..." }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'GET') {
        $limit = isset($_GET['limit']) ? max(1, min(100, (int) $_GET['limit'])) : 20;
        $resp = ChatOrchestratorApi::getInternalJson('/v1/admin/evolution/patches?limit=' . $limit, 30);
        if (! \is_array($resp)) {
            http_response_code(502);
            echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable'], JSON_UNESCAPED_UNICODE);

            return;
        }
        echo json_encode([
            'success' => true,
            'data'    => [
                'patches' => \is_array($resp['patches'] ?? null) ? $resp['patches'] : [],
            ],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'GET or POST only']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $patchId = trim((string) ($input['patch_id'] ?? ''));
    $action = strtolower(trim((string) ($input['action'] ?? '')));
    if ($patchId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'patch_id required']);

        return;
    }
    $path = match ($action) {
        'rollback' => '/v1/admin/evolution/rollback/' . rawurlencode($patchId),
        default => '/v1/admin/evolution/patches/' . rawurlencode($patchId) . '/approve',
    };
    $resp = ChatOrchestratorApi::postInternalJson($path, [], 60);
    if (! \is_array($resp)) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable'], JSON_UNESCAPED_UNICODE);

        return;
    }
    echo json_encode(['success' => true, 'data' => $resp], JSON_UNESCAPED_UNICODE);
};
