<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendMessage;

/** Chat-owned {@code chat.send.message} — empty-body defaults + continue-turn orchestrator prompt. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $raw = isset($payload['raw_content']) ? (string) $payload['raw_content'] : '';

    ChatSendMessage::apply($ctx, $raw);
};
