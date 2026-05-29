<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * {@code chat.send.run_start} boundary — POST {@code /v1/runs/chat} remains in {@see send.php} via {@code startOrchestratorChatRun}.
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
