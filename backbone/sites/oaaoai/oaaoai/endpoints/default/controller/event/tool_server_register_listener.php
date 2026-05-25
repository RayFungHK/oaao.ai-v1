<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\endpoints\\ToolServerRegister}.
 */

require_once dirname(__DIR__, 2) . '/library/ToolServerRegister.php';

use oaaoai\endpoints\ToolServerRegister;

return function (array $payload): void {
    $server_id = isset($payload['id']) && is_string($payload['id']) ? trim($payload['id']) : '';
    $base_url = isset($payload['base_url']) && is_string($payload['base_url']) ? trim($payload['base_url']) : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : $payload;

    ToolServerRegister::add($server_id, $base_url, $label, $extras);
};
