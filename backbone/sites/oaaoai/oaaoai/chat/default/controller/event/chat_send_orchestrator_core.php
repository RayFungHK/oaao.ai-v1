<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorCore;
use oaaoai\chat\ChatSendOrchestratorStage;

/** Chat-owned {@code chat.send.orchestrator_ready} core stage. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::CORE) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    $splitDb = $payload['split_db'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $conversationId = (int) ($payload['conversation_id'] ?? 0);
    $user = $payload['user'] ?? null;
    if ($conversationId < 1 || ! \is_object($user)) {
        return;
    }

    /** @var list<int> $attachmentIds */
    $attachmentIds = (isset($payload['attachment_ids']) && \is_array($payload['attachment_ids']))
        ? array_values(array_map('intval', $payload['attachment_ids']))
        : $ctx->attachmentIds;

    $coreApi = $this->api('core');
    $canonDb = $payload['canonical_db'] ?? null;
    $tenantFragment = ChatSendOrchestratorCore::tenantIdFragment(
        $canonDb instanceof \Razy\Database ? $canonDb : null,
        $user,
        $coreApi,
    );

    $ctx->mergePayloadFragment('chat', array_merge(
        ChatSendOrchestratorCore::buildFragment(
            $ctx,
            $ctx->workspaceId,
            (bool) ($payload['bubble_thread'] ?? false),
            (bool) ($payload['conversation_created'] ?? false),
            $splitDb,
            $conversationId,
            $user,
            $payload['auth_api'] ?? null,
            $payload['endpoints_api'] ?? null,
            $payload['slide_designer_api'] ?? null,
            $this,
            $attachmentIds,
        ),
        $tenantFragment,
    ));
};
