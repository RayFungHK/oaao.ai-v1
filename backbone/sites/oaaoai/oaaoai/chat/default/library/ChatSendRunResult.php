<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** Outcome of {@see ChatSendRunStarter::start()} — stream URL + assistant row state. */
final class ChatSendRunResult
{
    public function __construct(
        public readonly ?string $streamUrl = null,
        public readonly ?string $runId = null,
        public readonly ?string $streamToken = null,
        public readonly string $assistantOut = '',
        public readonly bool $autoCompactApplied = false,
    ) {
    }
}
