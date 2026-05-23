<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * In-app notifications — news, invitations, job updates, system messages.
 */
final class NotificationRepository
{
    public function __construct(private readonly \PDO $pdo)
    {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listForUser(int $userId, int $limit = 50, bool $unreadOnly = false): array
    {
        if ($userId < 1) {
            return [];
        }
        $limit = max(1, min(200, $limit));
        $sql = 'SELECT notification_id, kind, title, body, payload_json, read_at::text AS read_at, created_at::text AS created_at
                FROM oaao_notification
                WHERE user_id = ?';
        if ($unreadOnly) {
            $sql .= ' AND read_at IS NULL';
        }
        $sql .= ' ORDER BY created_at DESC LIMIT ' . $limit;
        $st = $this->pdo->prepare($sql);
        $st->execute([$userId]);
        /** @var list<array<string, mixed>> $rows */
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        return $rows;
    }

    public function unreadCount(int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        $st = $this->pdo->prepare(
            'SELECT COUNT(*) FROM oaao_notification WHERE user_id = ? AND read_at IS NULL',
        );
        $st->execute([$userId]);

        return max(0, (int) $st->fetchColumn());
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function create(int $userId, string $kind, string $title, ?string $body = null, array $payload = []): int
    {
        if ($userId < 1 || trim($title) === '') {
            return 0;
        }
        $kind = trim($kind) !== '' ? trim($kind) : 'system';
        $payloadJson = $payload !== [] ? json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) : null;
        $st = $this->pdo->prepare(
            'INSERT INTO oaao_notification (user_id, kind, title, body, payload_json)
             VALUES (?, ?, ?, ?, ?)
             RETURNING notification_id',
        );
        $st->execute([$userId, $kind, trim($title), $body, $payloadJson]);
        $id = $st->fetchColumn();

        return \is_numeric($id) ? (int) $id : 0;
    }

    /**
     * @param list<int> $ids
     */
    public function markRead(int $userId, array $ids): int
    {
        if ($userId < 1 || $ids === []) {
            return 0;
        }
        $clean = [];
        foreach ($ids as $id) {
            $n = (int) $id;
            if ($n > 0) {
                $clean[$n] = $n;
            }
        }
        if ($clean === []) {
            return 0;
        }
        $placeholders = implode(',', array_fill(0, \count($clean), '?'));
        $params = array_values($clean);
        $params[] = $userId;
        $st = $this->pdo->prepare(
            "UPDATE oaao_notification SET read_at = CURRENT_TIMESTAMP
             WHERE notification_id IN ({$placeholders}) AND user_id = ? AND read_at IS NULL",
        );
        $st->execute($params);

        return $st->rowCount();
    }

    public function markAllRead(int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        $st = $this->pdo->prepare(
            'UPDATE oaao_notification SET read_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND read_at IS NULL',
        );
        $st->execute([$userId]);

        return $st->rowCount();
    }
}
