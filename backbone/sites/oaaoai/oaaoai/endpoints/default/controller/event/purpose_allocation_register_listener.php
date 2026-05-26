<?php

declare(strict_types=1);

/**
 * {@code oaaoai/endpoints} listener for {@code purpose_allocation.register}.
 *
 * Feature modules emit on their namespace ({@code oaaoai/chat:purpose_allocation.register}, {@code oaaoai/rag:…}, {@code oaaoai/vault:…}, {@code oaaoai/slide-designer:…}, {@code oaaoai/research:…}, {@code oaaoai/mine:…}, {@code oaaoai/user:…}, {@code oaaoai/endpoints:…});
 * this handler merges slot rows into {@see PurposeAllocationRegister} for shell JSON and downstream tools.
 *
 * {@see \oaaoai\endpoints\PurposeAllocationRegister}
 */

use oaaoai\endpoints\PurposeAllocationRegister;

return function (array $payload): void {
    $slot_id = isset($payload['slot_id']) && is_string($payload['slot_id']) ? trim($payload['slot_id']) : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? $payload['label'] : '';
    $title = isset($payload['title']) && is_string($payload['title']) ? $payload['title'] : '';
    $sub = isset($payload['sub']) && is_string($payload['sub']) ? $payload['sub'] : '';
    $icon = isset($payload['icon']) && is_string($payload['icon']) ? $payload['icon'] : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    PurposeAllocationRegister::add($slot_id, $label, $title, $sub, $icon, $extras);
};
