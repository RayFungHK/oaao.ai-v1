<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Early HTTP validation for {@code POST /chat/api/send} — throws {@see ChatSendAbort}.
 */
final class ChatSendValidator
{
    public static function assertAuthenticatedUser(int $userId): void
    {
        if ($userId < 1) {
            throw new ChatSendAbort(401, [
                'success' => false,
                'message' => 'Invalid session',
            ]);
        }
    }

    public static function assertContinueConversation(?int $conversationId, bool $appendAssistantTurn): void
    {
        if ($appendAssistantTurn && ($conversationId === null || $conversationId < 1)) {
            throw new ChatSendAbort(400, [
                'success' => false,
                'message' => 'conversation_id required for continue',
            ]);
        }
    }

    public static function assertContentLength(string $content, int $maxLength = 32000): void
    {
        if (strlen($content) > $maxLength) {
            throw new ChatSendAbort(400, [
                'success' => false,
                'message' => 'Message too long',
            ]);
        }
    }

    public static function assertRunnableChatEndpoint(?\Razy\Database $canonDb, int $chatEndpointId): void
    {
        if ($chatEndpointId < 1) {
            return;
        }
        if (! $canonDb instanceof \Razy\Database
            || ! ChatRoutingSelectableProfiles::isRunnableId($canonDb, $chatEndpointId)) {
            throw new ChatSendAbort(400, [
                'success' => false,
                'message' => 'Invalid chat completion profile',
            ]);
        }
    }
}
