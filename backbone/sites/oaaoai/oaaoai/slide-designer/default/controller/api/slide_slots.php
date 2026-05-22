<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideProjectRegistry;

/**
 * POST /slide-designer/api/slide_slots
 * Body: { project_id, page|slide_index }
 */
return function (): void {
    $chatApi = $this->api('chat');
    if (! $chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable']);
        return;
    }

    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $projectId = trim((string) ($input['project_id'] ?? ''));
    $page = max(1, (int) ($input['page'] ?? $input['slide_index'] ?? 0));
    $cid = (int) ($input['conversation_id'] ?? 0);

    if ($projectId === '' || $page < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'project_id, page, and conversation_id required']);

        return;
    }

    if (SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $uid, $cid) === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Project not found']);

        return;
    }

    $result = SlideOrchestrator::listSlideSlots($chatApi, $projectId, $page);
    if ($result === null) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    echo json_encode([
        'success' => $ok,
        'message' => $ok ? 'OK' : (string) ($result['error'] ?? 'slide_slots_failed'),
        'data'    => $result,
    ], JSON_UNESCAPED_UNICODE);
};
