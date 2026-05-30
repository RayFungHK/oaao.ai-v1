<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\corpus\CorpusSendOrchestratorPayload;

/** Corpus {@code chat.send.orchestrator_ready} finalize stage — corpus_id + style for chat runs. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::FINALIZE) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    $canonDb = $payload['canonical_db'] ?? null;
    $user = $payload['user'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $canonDb instanceof \Razy\Database || ! \is_object($user)) {
        return;
    }

    /** @var array<string, mixed> $orchPayload */
    $orchPayload = (isset($payload['orchestrator_payload']) && \is_array($payload['orchestrator_payload']))
        ? $payload['orchestrator_payload']
        : [];

    $ctx->mergePayloadFragment(
        'corpus',
        CorpusSendOrchestratorPayload::buildFragment(
            $ctx,
            $orchPayload,
            $canonDb,
            $user,
            $ctx->workspaceId,
        ),
    );
};
