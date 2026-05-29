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
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ChatSendContext $ctx,
        array $payload,
        object $user,
        ?\PDO $canonPdo,
        int $conversationId,
    ): array {
        $fragment = [];
        $uid = $ctx->userId;

        if ($canonPdo instanceof \PDO) {
            require_once dirname(__DIR__, 3) . '/auth/default/controller/api/_ensure_todo_schema.php';
            oaao_auth_ensure_todo_schema($canonPdo);
            $tenantForTodos = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : (int) ($user->tenant_id ?? 0);
            $stTodos = $canonPdo->prepare(
                'SELECT todo_id, title FROM oaao_todo_item
                 WHERE tenant_id = ? AND user_id = ? AND status = ? AND conversation_id = ?
                 ORDER BY updated_at DESC LIMIT 20',
            );
            $stTodos->execute([$tenantForTodos, $uid, 'open', $conversationId]);
            $openTodos = [];
            while ($row = $stTodos->fetch(\PDO::FETCH_ASSOC)) {
                if (! \is_array($row)) {
                    continue;
                }
                $openTodos[] = [
                    'todo_id' => (int) ($row['todo_id'] ?? 0),
                    'title'   => (string) ($row['title'] ?? ''),
                ];
            }
            if ($openTodos !== []) {
                $fragment['open_todo_items'] = $openTodos;
            }
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
