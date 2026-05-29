<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * Placeholder for {@code chat.send.conversation_settle} — provisional title, thread params, inference meta.
 *
 * @see docs/design/chat-send-pipeline.md § conversation_settle
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
