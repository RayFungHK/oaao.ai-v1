<?php

declare(strict_types=1);

use oaaoai\chat\SkillsManifestStorage;

/**
 * POST /chat/api/skills_manifest_save — administrator: replace persisted hot-plug skills JSON.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    require_once __DIR__ . '/../../library/SkillsManifestStorage.php';

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $raw = $input['skills'] ?? $input['hot_plug_skills'] ?? null;
    if (! \is_array($raw)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Expected skills[] array'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $normalized = [];
    foreach ($raw as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? $row['skill_id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $normalized[] = SkillsManifestStorage::normalizeRow($row);
    }

    if (! SkillsManifestStorage::savePersisted($normalized)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not write skills manifest file'], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'skills' => SkillsManifestStorage::loadPersisted(),
            'path'   => SkillsManifestStorage::configPath(),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
