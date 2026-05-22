<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/MicroSkillStorage.php';

use oaaoai\chat\MicroSkillStorage;

/**
 * POST /chat/api/skills_save — save conversation micro skill (draft or published).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    $auth->restrict(true);
    $user = $auth->getUser();
    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }
    $splitDb = $auth->getDBSplit();
    $pdo = $splitDb?->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : null;

    $row = MicroSkillStorage::saveDraft(
        $pdo,
        $uid,
        $wid !== null && $wid > 0 ? $wid : null,
        $input,
    );
    if ($row === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid skill payload']);

        return;
    }

    echo json_encode(['success' => true, 'data' => ['skill' => $row]], JSON_UNESCAPED_UNICODE);
};
