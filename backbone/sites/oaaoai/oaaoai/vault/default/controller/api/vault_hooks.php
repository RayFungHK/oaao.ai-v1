<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/../library/VaultDocumentHookRegister.php';

use oaaoai\vault\VaultDocumentHookRegister;

/**
 * GET /vault/api/vault_hooks — registry snapshot (mirrors embedded shell JSON; useful for hot dev reload).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$auth, $user] = $this->oaao_vault_require_authenticated_only();
    if (! $auth || ! $user) {
        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'hooks' => VaultDocumentHookRegister::allSorted(),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
