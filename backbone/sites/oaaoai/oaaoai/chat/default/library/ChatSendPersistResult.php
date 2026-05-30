<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** Outcome of {@see ChatSendPersist::execute()} after a successful adjunct SQLite commit. */
final class ChatSendPersistResult
{
    public function __construct(
        public readonly int $conversationId,
        public readonly bool $conversationCreated,
        public readonly bool $bubbleThread,
        public readonly string $conversationModeId,
        public readonly string $plannerModeId,
        public readonly int $userMsgId,
        public readonly int $asstMsgId,
        public readonly string $assistantInsertContent,
        public readonly ?string $conversationTitleOut,
        /** @var array<string, mixed> */
        public readonly array $inferenceSnapshot,
        public readonly int $priorLastMessageId = 0,
    ) {
    }
}
