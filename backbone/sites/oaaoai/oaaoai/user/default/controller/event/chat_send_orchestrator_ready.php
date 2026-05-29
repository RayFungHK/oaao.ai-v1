<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\user\UserSendOrchestratorPayload;

/** User-owned {@code chat.send.orchestrator_ready} personalize stage. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::PERSONALIZE) {
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

    $canonPdo = $payload['canonical_pdo'] ?? null;
    /** @var array<string, mixed> $orchPayload */
    $orchPayload = (isset($payload['orchestrator_payload']) && \is_array($payload['orchestrator_payload']))
        ? $payload['orchestrator_payload']
        : [];

    $ctx->mergePayloadFragment('user', UserSendOrchestratorPayload::buildFragment(
        $ctx,
        $orchPayload,
        $user,
        $canonPdo instanceof \PDO ? $canonPdo : null,
        (int) ($payload['conversation_id'] ?? 0),
    ));
};
