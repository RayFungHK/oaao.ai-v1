<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/**
 * Placeholder for {@code chat.send.gate} — credit / workspace / auth gates still inline in {@see send.php} until migrated.
 */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }
};
