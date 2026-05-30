<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\PostTurnActionRegister}.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/PostTurnActionRegister.php';

use oaaoai\chat\PostTurnActionRegister;

return function (array $payload): void {
    $action_id = isset($payload['action_id']) && is_string($payload['action_id'])
        ? trim($payload['action_id'])
        : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    PostTurnActionRegister::add($action_id, $label, $extras);
};
