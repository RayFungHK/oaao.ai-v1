<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendGate;

/** Chat-owned {@code chat.send.gate} — credits + workspace scope. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $user = $payload['user'] ?? null;
    $authApi = $payload['auth_api'] ?? null;
    $coreApi = $payload['core_api'] ?? null;
    $canonDb = $payload['canonical_db'] ?? null;
    $canonPdo = $canonDb instanceof \Razy\Database ? $canonDb->getDBAdapter() : null;

    $tenantId = ($user !== null && isset($user->tenant_id)) ? (int) $user->tenant_id : 0;
    $creditBlock = ChatSendGate::creditBlockedReason(
        $canonPdo instanceof \PDO ? $canonPdo : null,
        $tenantId,
        $ctx->userId,
        \is_object($coreApi) ? $coreApi : null,
    );
    if ($creditBlock !== null) {
        $ctx->abort(402, [
            'success' => false,
            'message' => $creditBlock,
            'code'    => 'credits_exhausted',
        ]);
    }

    $workspaceDenial = ChatSendGate::workspaceDenial(
        $ctx->userId,
        $ctx->workspaceId,
        \is_object($authApi) ? $authApi : null,
    );
    if ($workspaceDenial !== null) {
        $ctx->abort(
            (int) $workspaceDenial['httpStatus'],
            $workspaceDenial['payload'],
        );
    }
};
