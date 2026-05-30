<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\StripActionRegister}.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/StripActionRegister.php';

use oaaoai\chat\StripActionRegister;

return function (array $payload): void {
    $action_id = isset($payload['action_id']) && is_string($payload['action_id'])
        ? trim($payload['action_id'])
        : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    StripActionRegister::add($action_id, $extras);
};
