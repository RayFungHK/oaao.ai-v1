<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorBinding;
use oaaoai\chat\ChatSendOrchestratorStage;

/** Chat-owned {@code chat.send.orchestrator_ready} bind stage — endpoint profile + sidecar base. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::BIND) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    $canonDb = $payload['canonical_db'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $canonDb instanceof \Razy\Database) {
        return;
    }

    $ctx->binding = ChatSendOrchestratorBinding::resolveBinding($canonDb, $ctx->chatEndpointId);
    $ctx->internalBase = ChatSendOrchestratorBinding::resolveInternalBase();
    $ctx->orchReady = ChatSendOrchestratorBinding::isReady($ctx->binding, $ctx->internalBase);
};
