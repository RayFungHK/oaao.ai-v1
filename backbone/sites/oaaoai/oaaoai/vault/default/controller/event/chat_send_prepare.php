<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\vault\VaultSendScope;

/** Vault-owned {@code chat.send.prepare} — composer vault scope + auto-RAG flag. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $parsed = VaultSendScope::parseComposerInput($ctx->input);
    $ctx->vaultSourceRefs = $parsed['refs'];
    $ctx->vaultSourceIds = $parsed['ids'];
    $ctx->vaultAutoRag = $parsed['auto_rag'];
};
