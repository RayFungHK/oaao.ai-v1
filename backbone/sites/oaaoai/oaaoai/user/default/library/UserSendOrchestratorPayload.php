<?php

declare(strict_types=1);

namespace oaaoai\user;

use oaaoai\chat\ChatSendContext;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserPersonalization;
use oaaoai\user\UserPreferenceProfile;

/**
 * User-owned orchestrator payload — personalization and open todos.
 */
final class UserSendOrchestratorPayload
{
    /**
     * @param array<string, mixed> $payload Existing orchestrator payload (for tenant_id)
     * @param list<array{todo_id: int, title: string}>|null $openTodoItems Pre-fetched via {@code api('todo')->openItemsForConversation()}
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ChatSendContext $ctx,
        array $payload,
        object $user,
        ?\PDO $canonPdo,
        int $conversationId,
        ?array $openTodoItems = null,
    ): array {
        $fragment = [];
        $uid = $ctx->userId;

        if ($canonPdo instanceof \PDO && \is_array($openTodoItems) && $openTodoItems !== []) {
            $fragment['open_todo_items'] = $openTodoItems;
        }

        $persPayload = UserPersonalization::forOrchestratorPayload(
            $canonPdo instanceof \PDO
                ? UserPersonalization::loadForUser($canonPdo, $uid)
                : UserPersonalization::defaults(),
        );
        if ($canonPdo instanceof \PDO) {
            $stmtPrefs = $canonPdo->prepare(
                'SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1',
            );
            $stmtPrefs->execute([$uid]);
            $rawPrefs = $stmtPrefs->fetchColumn();
            if (\is_string($rawPrefs) && $rawPrefs !== '') {
                try {
                    $decodedPrefs = json_decode($rawPrefs, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($decodedPrefs)) {
                        $persPayload = array_merge(
                            $persPayload,
                            UserPreferenceProfile::forOrchestratorPayload($decodedPrefs),
                        );
                    }
                } catch (\JsonException) {
                }
            }
        }
        $fragment['user_personalization'] = $persPayload;
        $fragment['display_locale'] = $canonPdo instanceof \PDO
            ? UserDisplayPreferences::localeForUser($canonPdo, $uid)
            : UserDisplayPreferences::DEFAULT_LOCALE;

        return $fragment;
    }
}
