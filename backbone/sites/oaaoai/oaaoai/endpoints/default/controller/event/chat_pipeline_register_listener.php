<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\ChatPipelineRegister} — loaded early from {@code oaaoai/endpoints} ({@see endpoints.php})
 * so {@code oaaoai/rag} / {@code oaaoai/chat} triggers resolve before dependent modules initialise listeners themselves.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/ChatPipelineRegister.php';

use oaaoai\chat\ChatPipelineRegister;

return function (array $payload): void {
    $entry_id = isset($payload['entry_id']) && is_string($payload['entry_id']) ? trim($payload['entry_id']) : '';
    $kind = isset($payload['kind']) && is_string($payload['kind']) ? trim($payload['kind']) : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    ChatPipelineRegister::add($entry_id, $kind, $label, $extras);
};
