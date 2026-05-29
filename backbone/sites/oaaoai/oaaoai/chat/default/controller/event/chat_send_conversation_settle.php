<?php

declare(strict_types=1);

use oaaoai\chat\ChatAttachmentManifest;
use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendConversationSettle;

/** Chat-owned {@code chat.send.conversation_settle} — title, inference meta, base user meta. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    $splitDb = $payload['split_db'] ?? null;
    $conversationId = (int) ($payload['conversation_id'] ?? 0);
    if (! $ctx instanceof ChatSendContext || ! $splitDb instanceof \Razy\Database || $conversationId < 1) {
        return;
    }

    /** @var list<array<string, mixed>> $attachmentRows */
    $attachmentRows = (isset($payload['attachment_rows']) && \is_array($payload['attachment_rows']))
        ? $payload['attachment_rows']
        : [];
    $ctx->attachmentRows = $attachmentRows;

    $nowMsg = isset($payload['now_msg']) && \is_string($payload['now_msg']) && $payload['now_msg'] !== ''
        ? $payload['now_msg']
        : date('Y-m-d H:i:s');

    $paramsDec = (isset($payload['params_dec']) && \is_array($payload['params_dec']))
        ? $payload['params_dec']
        : null;
    $ctx->paramsDec = $paramsDec;

    $canonDb = $payload['canonical_db'] ?? null;
    $canonPdo = $payload['canonical_pdo'] ?? null;

    $ctx->conversationTitleOut = ChatSendConversationSettle::applyProvisionalTitle(
        $splitDb,
        $conversationId,
        $ctx->userId,
        $ctx->orchestratorUserContent,
        $attachmentRows,
        $nowMsg,
    );

    $inference = ChatSendConversationSettle::resolveInferenceForSend(
        $canonDb instanceof \Razy\Database ? $canonDb : null,
        $ctx->chatEndpointId,
        $ctx->userId,
        $paramsDec,
        $canonPdo instanceof \PDO ? $canonPdo : null,
    );
    $ctx->inferenceSnapshot = $inference['snapshot'];
    $ctx->inferenceApplied = $inference['params'];

    /** @var array<string, mixed> $userMetaArr */
    $userMetaArr = [];
    if ($attachmentRows !== []) {
        $userMetaArr['attachments'] = ChatAttachmentManifest::manifestFromRows($attachmentRows, false);
    }
    $userMetaArr['inference'] = $ctx->inferenceSnapshot;
    $continueAssistantId = (int) ($payload['continue_assistant_id'] ?? 0);
    $ctx->userMetaArr = ChatSendConversationSettle::appendContinueTurnMeta(
        $userMetaArr,
        $ctx->appendAssistantTurn,
        $continueAssistantId,
    );
};
