<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** Inputs for {@see ChatSendResponder::emit()} after persist + run_start. */
final class ChatSendRespondInput
{
    /**
     * @param array<string, mixed> $inferenceSnapshot
     */
    public function __construct(
        public readonly int $conversationId,
        public readonly int $userMsgId,
        public readonly int $asstMsgId,
        public readonly string $assistantOut,
        public readonly ?string $streamUrl,
        public readonly ?string $runId,
        public readonly ?string $streamToken,
        public readonly bool $orchReady,
        public readonly ?int $workspaceId,
        public readonly ?string $conversationTitleOut,
        public readonly bool $autoCompactApplied,
        public readonly array $inferenceSnapshot,
    ) {
    }
}
