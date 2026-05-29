<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * Placeholder for {@code chat.send.orchestrator_ready} — endpoint binding, agent catalog, vault profiles, slide extras.
 *
 * @see docs/design/chat-send-pipeline.md § orchestrator_ready
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
