<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/MicroSkillCatalog.php';
require_once dirname(__DIR__, 2) . '/library/MicroSkillsRegister.php';

use oaaoai\chat\MicroSkillCatalog;
use oaaoai\chat\MicroSkillsRegister;

/**
 * GET /chat/api/skills_list — micro skills catalog (bound templates + conversation).
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

    $wid = isset($_GET['workspace_id']) ? (int) $_GET['workspace_id'] : null;
    $templateId = isset($_GET['template_id']) ? trim((string) $_GET['template_id']) : null;

    $skills = MicroSkillCatalog::forPlanner(
        $pdo,
        $user,
        $auth,
        $uid,
        $wid !== null && $wid > 0 ? $wid : null,
        $templateId !== '' ? $templateId : null,
        $this,
        $this->api('slide_designer'),
    );

    echo json_encode([
        'success' => true,
        'data'    => [
            'skills'    => $skills,
            'providers' => MicroSkillsRegister::allSorted(),
            'kinds'     => MicroSkillsRegister::kinds(),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
