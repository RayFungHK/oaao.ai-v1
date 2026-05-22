<?php

declare(strict_types=1);

use oaaoai\chat\ChatEndpointsRepository;

/**
 * GET /chat/api/chat_endpoints_list — administrator-only chat completion profiles + LLM bindings.
 */
return function (): void {
    $db = $this->oaao_chat_require_admin();
    if (! $db) {
        return;
    }

    require_once __DIR__ . '/_ensure_chat_profile_tables.php';
    oaao_chat_ensure_profile_tables($db);

    try {
        $repo = new ChatEndpointsRepository($db, $this->api('core'));
        $profiles = $repo->listProfiles();
        echo json_encode(['success' => true, 'profiles' => $profiles ?: []], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log(sprintf('[chat_endpoints_list] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load chat endpoints']);
    }
};
