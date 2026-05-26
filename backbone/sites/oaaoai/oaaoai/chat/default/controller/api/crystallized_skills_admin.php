<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\chat\CrystallizedSkillsStorage;

/**
 * GET /chat/api/crystallized_skills_admin — administrator: crystallized skills + stats.
 * POST body { "disabled_ids": ["..."] } — persist disable list overlay.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    require_once __DIR__ . '/../../library/CrystallizedSkillsStorage.php';

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (! \is_array($input)) {
            $input = [];
        }
        $disabled = $input['disabled_ids'] ?? [];
        if (! \is_array($disabled)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'disabled_ids must be array']);

            return;
        }
        if (! CrystallizedSkillsStorage::saveDisabledIds($disabled)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'save_failed']);

            return;
        }
        echo json_encode([
            'success' => true,
            'data'    => [
                'disabled_ids' => CrystallizedSkillsStorage::loadDisabledIds(),
                'path'         => CrystallizedSkillsStorage::configPath(),
            ],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $limit = isset($_GET['limit']) ? max(1, min(200, (int) $_GET['limit'])) : 50;
    $skillsResp = ChatOrchestratorApi::getInternalJson('/v1/admin/crystallization/skills?limit=' . $limit, 30);
    $statsResp = ChatOrchestratorApi::getInternalJson('/v1/admin/crystallization/stats', 15);
    $disabled = CrystallizedSkillsStorage::loadDisabledIds();
    $skills = \is_array($skillsResp['skills'] ?? null) ? $skillsResp['skills'] : [];
    foreach ($skills as &$row) {
        if (! \is_array($row)) {
            continue;
        }
        $sid = trim((string) ($row['id'] ?? ''));
        $row['disabled'] = $sid !== '' && \in_array($sid, $disabled, true);
    }
    unset($row);

    echo json_encode([
        'success' => true,
        'data'    => [
            'skills'         => $skills,
            'skill_count'    => \count($skills),
            'disabled_ids'   => $disabled,
            'manifest_path'  => CrystallizedSkillsStorage::configPath(),
            'stats'          => \is_array($statsResp) ? $statsResp : [],
        ],
    ], JSON_UNESCAPED_UNICODE);
};
