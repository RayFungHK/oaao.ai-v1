<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/MicroSkillCatalog.php';

use oaaoai\chat\MicroSkillCatalog;

/**
 * POST /chat/api/skills_discover — LLM: find similar skills or suggest new (preview markdown).
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
    $message = trim((string) ($input['message'] ?? ''));
    if ($message === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'message required']);

        return;
    }

    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : null;
    $templateId = trim((string) ($input['template_id'] ?? ''));
    $slideDesigner = $this->api('slide_designer');
    $catalog = MicroSkillCatalog::forPlanner(
        $pdo,
        $user,
        $auth,
        $uid,
        $wid !== null && $wid > 0 ? $wid : null,
        $templateId !== '' ? $templateId : null,
        $this,
        $slideDesigner,
    );

    $canonDb = $auth->getDB();
    $binding = null;
    if ($canonDb instanceof \Razy\Database) {
        require_once dirname(__DIR__, 2) . '/library/ChatOrchestratorBootstrap.php';
        $binding = \oaaoai\chat\ChatOrchestratorBootstrap::resolveDefaultBinding($canonDb);
    }
    if ($binding === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'LLM endpoint not configured']);

        return;
    }

    if (! $slideDesigner) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Slide designer module unavailable']);

        return;
    }

    $result = $slideDesigner->discoverSkillsForPlanner(
        $message,
        $catalog,
        trim((string) ($input['conversation_excerpt'] ?? '')),
        $binding,
    );
    if ($result === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    echo json_encode(['success' => true, 'data' => $result], JSON_UNESCAPED_UNICODE);
};
