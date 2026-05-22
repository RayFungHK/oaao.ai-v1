<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideProjectRegistry;

/**
 * GET /slide-designer/api/project_resume?project_id=&conversation_id=
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $projectId = isset($_GET['project_id']) && is_string($_GET['project_id'])
        ? trim($_GET['project_id'])
        : '';
    $cid = (int) ($_GET['conversation_id'] ?? 0);

    if ($projectId === '' || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'project_id and conversation_id required']);

        return;
    }

    $resumed = SlideProjectRegistry::resumeProject($pdo, $projectId, $uid, $cid);
    if ($resumed === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Project not found']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'project_id' => $projectId,
            'manifest'   => $resumed['manifest'],
            'status'     => $resumed['manifest']['status'] ?? ($resumed['row']['status'] ?? 'draft'),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
