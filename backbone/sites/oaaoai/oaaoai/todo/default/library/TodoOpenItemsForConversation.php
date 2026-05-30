<?php

declare(strict_types=1);

namespace oaaoai\todo;

/**
 * Todo-owned open items for chat orchestrator payload — no SQL in user/chat modules.
 */
final class TodoOpenItemsForConversation
{
    /**
     * @return list<array{todo_id: int, title: string}>
     */
    public static function listForConversation(
        \PDO $canonPdo,
        int $tenantId,
        int $userId,
        int $conversationId,
        int $limit = 20,
    ): array {
        if ($tenantId < 1 || $userId < 1 || $conversationId < 1) {
            return [];
        }

        $limit = max(1, min(50, $limit));
        $stTodos = $canonPdo->prepare(
            'SELECT todo_id, title FROM oaao_todo_item
             WHERE tenant_id = ? AND user_id = ? AND status = ? AND conversation_id = ?
             ORDER BY updated_at DESC LIMIT ' . $limit,
        );
        $stTodos->execute([$tenantId, $userId, 'open', $conversationId]);

        /** @var list<array{todo_id: int, title: string}> $openTodos */
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

        return $openTodos;
    }
}
