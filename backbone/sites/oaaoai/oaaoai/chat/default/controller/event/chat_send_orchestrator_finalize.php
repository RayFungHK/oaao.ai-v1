<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorFinalize;
use oaaoai\chat\ChatSendOrchestratorStage;

/** Chat-owned {@code chat.send.orchestrator_ready} finalize stage. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::FINALIZE) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $user = $payload['user'] ?? null;
    if (! \is_object($user)) {
        return;
    }

    /** @var array<string, mixed> $orchPayload */
    $orchPayload = (isset($payload['orchestrator_payload']) && \is_array($payload['orchestrator_payload']))
        ? $payload['orchestrator_payload']
        : [];

    $ctx->mergePayloadFragment('chat', ChatSendOrchestratorFinalize::buildFragment(
        $ctx,
        $orchPayload,
        $ctx->inferenceApplied,
        $ctx->inferenceSnapshot,
        $user,
        ($payload['canonical_db'] ?? null) instanceof \Razy\Database ? $payload['canonical_db'] : null,
        $ctx->workspaceId,
        (int) ($payload['conversation_id'] ?? 0),
        (int) ($payload['assistant_message_id'] ?? 0),
        (int) ($payload['continue_assistant_id'] ?? 0),
    ));
};
