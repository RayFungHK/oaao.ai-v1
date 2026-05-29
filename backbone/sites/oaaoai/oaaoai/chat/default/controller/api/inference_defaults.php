<?php

declare(strict_types=1);

use oaaoai\endpoints\ChatInferencePurposeConfig;

/**
 * GET /chat/api/inference_defaults?chat_endpoint_id=
 *
 * UX-1 — purpose/chat-profile inference presets for composer Advanced panel.
 */
return function (): void {
    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user) {
        return;
    }

    $chatEndpointRaw = $_GET['chat_endpoint_id'] ?? null;
    $chatEndpointId = ($chatEndpointRaw === null || $chatEndpointRaw === '') ? 0 : (int) $chatEndpointRaw;

    $auth = $this->api('auth');
    $canonDb = $auth?->getDB();
    if (! $canonDb instanceof \Razy\Database) {
        echo json_encode(['success' => true, 'data' => ['inference_params' => [], 'chat_endpoint_id' => $chatEndpointId]]);

        return;
    }

    require_once dirname(__DIR__, 4) . '/endpoints/default/library/ChatInferencePurposeConfig.php';

    $defaults = ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint($canonDb, $chatEndpointId);

    echo json_encode([
        'success' => true,
        'data'    => [
            'chat_endpoint_id'  => $chatEndpointId,
            'inference_params' => $defaults,
            'source'            => 'chat.purpose',
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
