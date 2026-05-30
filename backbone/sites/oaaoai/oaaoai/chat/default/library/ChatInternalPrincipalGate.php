<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Optional {@code run_principal} verification on orchestrator internal HTTP calls.
 */
final class ChatInternalPrincipalGate
{
    /**
     * When {@code run_principal} is present, verify it matches conversation + assistant message ids.
     */
    public static function verifyOptional(array $input, int $conversationId, int $assistantMessageId): bool
    {
        $token = isset($input['run_principal']) && \is_string($input['run_principal'])
            ? trim($input['run_principal'])
            : '';
        if ($token === '') {
            return true;
        }

        $principal = ChatRunPrincipal::verify($token);
        if ($principal === null) {
            return false;
        }

        return (int) $principal['conversation_id'] === $conversationId
            && (int) $principal['assistant_message_id'] === $assistantMessageId;
    }
}
