<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /chat/api/evolution_reports — administrator: recent evolution daily reports.
 * POST body { "report_id": "...", "status": "reviewed"|"dismissed"|"pending_review" }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (! \is_array($input)) {
            $input = [];
        }
        $reportId = trim((string) ($input['report_id'] ?? ''));
        $status = trim((string) ($input['status'] ?? ''));
        if ($reportId === '' || $status === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'report_id and status required']);

            return;
        }
        $resp = ChatOrchestratorApi::postInternalJson(
            '/v1/admin/evolution/reports/' . rawurlencode($reportId) . '/review',
            ['status' => $status],
            30,
        );
        if (! \is_array($resp)) {
            http_response_code(502);
            echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable'], JSON_UNESCAPED_UNICODE);

            return;
        }
        echo json_encode([
            'success' => true,
            'data'    => [
                'report' => \is_array($resp['report'] ?? null) ? $resp['report'] : $resp,
            ],
        ], JSON_UNESCAPED_UNICODE);

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
