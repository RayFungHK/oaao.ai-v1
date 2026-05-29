<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * {@code chat.send.persist} boundary — adjunct SQLite TX is owned by {@see ChatSendPersist}.
 *
 * @see docs/design/chat-send-pipeline.md
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
