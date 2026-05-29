<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Early exit from {@see ChatSendPipeline} — {@see send.php} catches and emits JSON.
 */
final class ChatSendAbort extends \RuntimeException
{
    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public readonly int $httpStatus,
        public readonly array $payload,
    ) {
        parent::__construct((string) ($payload['message'] ?? 'Chat send aborted'), $httpStatus);
    }
}
