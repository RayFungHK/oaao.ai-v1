<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\chat\ChatSendScopeResolver;

/** Chat-owned {@code chat.send.scope} — expand vault composer scope from message content. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    $canonDb = $payload['canonical_db'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $canonDb instanceof \Razy\Database) {
        return;
    }

    $authApi = $payload['auth_api'] ?? null;
    ChatSendScopeResolver::expand(
        $ctx,
        $canonDb,
        \is_object($authApi) ? $authApi : null,
        fn (int $uid, ?int $wid): array => $this->embeddedVaultIdsForUserWorkspace($uid, $wid),
    );
};
