<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendComposer;
use oaaoai\chat\ChatSendContext;

/** Chat-owned {@code chat.send.prepare} — web search flag + ephemeral attachments. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $ctx->enableWebSearch = ChatSendComposer::parseEnableWebSearch($ctx->input);
    $ctx->attachmentIds = ChatSendComposer::parseAttachmentIds($ctx->input);
};
