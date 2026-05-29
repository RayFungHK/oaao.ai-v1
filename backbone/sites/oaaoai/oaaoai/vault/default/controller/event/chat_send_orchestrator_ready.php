<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\vault\VaultSendOrchestratorPayload;

/** Vault {@code chat.send.orchestrator_ready} payload stage — retrieval profiles + glossary. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::PAYLOAD) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    $canonDb = $payload['canonical_db'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $canonDb instanceof \Razy\Database) {
        return;
    }

    $chatApi = $this->api('chat');
    $vaultApi = $this;
    $wid = $ctx->workspaceId !== null && $ctx->workspaceId > 0 ? $ctx->workspaceId : null;

    $ctx->mergePayloadFragment(
        'vault',
        VaultSendOrchestratorPayload::buildFragment(
            $ctx->userId,
            $wid,
            $ctx->vaultSourceIds,
            $ctx->vaultSourceRefs,
            $canonDb,
            $chatApi,
            $vaultApi,
        ),
    );
};
