<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/** Chat-owned {@code chat.send.respond} — modules may mutate {@see ChatSendContext::$responsePayload}. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
