<?php

declare(strict_types=1);

use oaaoai\chat\ChatEndpointsRepository;

/**
 * POST /chat/api/chat_endpoints_delete — delete profile + LLM rows.
 *
 * Body JSON: { "id": number }
 */
return function (): void {
    $db = $this->oaao_chat_require_admin();
    if (! $db) {
        return;
    }

    require_once __DIR__ . '/_ensure_chat_profile_tables.php';
    oaao_chat_ensure_profile_tables($db);

    $input = json_decode((string) file_get_contents('php://input'), true);
    $id = is_array($input) ? (int) ($input['id'] ?? 0) : 0;
    if ($id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid id']);

        return;
    }

    try {
        $repo = new ChatEndpointsRepository($db, $this->api('core'));
        $n = $repo->deleteProfile($id);
        if ($n < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Profile not found']);

            return;
        }
        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to delete chat endpoint']);
    }
};
