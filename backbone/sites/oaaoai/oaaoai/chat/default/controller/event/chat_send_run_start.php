<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * {@code chat.send.run_start} boundary — fired by {@see ChatSendRunStarter} immediately before POST.
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
