<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\vault\\VaultDocumentHookRegister} — loaded from {@code oaaoai/endpoints} ({@see endpoints.php})
 * so {@code oaaoai/vault} / {@code oaaoai/rag} triggers resolve during greedy bootstrap.
 */

require_once dirname(__DIR__, 4) . '/vault/default/library/VaultDocumentHookRegister.php';

use oaaoai\vault\VaultDocumentHookRegister;

return function (array $payload): void {
    $hook_id = isset($payload['hook_id']) && is_string($payload['hook_id']) ? trim($payload['hook_id']) : '';
    $kind = isset($payload['kind']) && is_string($payload['kind']) ? trim($payload['kind']) : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    VaultDocumentHookRegister::add($hook_id, $kind, $label, $extras);
};
