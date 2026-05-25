<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /chat/api/evolution_reports — administrator: recent evolution daily reports.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    $limit = isset($_GET['limit']) ? max(1, min(50, (int) $_GET['limit'])) : 10;
    $resp = ChatOrchestratorApi::getInternalJson('/v1/admin/evolution/reports?limit=' . $limit, 30);
    if (! \is_array($resp)) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'reports' => \is_array($resp['reports'] ?? null) ? $resp['reports'] : [],
        ],
    ], JSON_UNESCAPED_UNICODE);
};
