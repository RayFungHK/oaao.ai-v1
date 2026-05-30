<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * PLAT-1-S4 — batched cross-tenant notification fan-out (resumable cursor).
 */
final class ReleasePostFanout
{
    public const BATCH_SIZE = 250;

    public function __construct(private readonly \PDO $pdo)
    {
    }

    public function ensureSchema(): void
    {
        $cols = [
            'fanout_status'             => "VARCHAR(32) NOT NULL DEFAULT ''",
            'fanout_cursor_user_id'     => 'BIGINT NOT NULL DEFAULT 0',
            'fanout_notifications_total'=> 'INT NOT NULL DEFAULT 0',
        ];
        foreach ($cols as $name => $ddl) {
            $st = $this->pdo->query(
                "SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'oaao_release_post' AND column_name = " . $this->pdo->quote($name),
            );
            if ($st && $st->fetchColumn()) {
                continue;
            }
            $this->pdo->exec("ALTER TABLE oaao_release_post ADD COLUMN {$name} {$ddl}");
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    public function loadPost(int $postId): ?array
    {
        if ($postId < 1) {
            return null;
        }
        $st = $this->pdo->prepare('SELECT * FROM oaao_release_post WHERE release_post_id = ? LIMIT 1');
        $st->execute([$postId]);

        $row = $st->fetch(\PDO::FETCH_ASSOC);

        return \is_array($row) ? $row : null;
    }

    /**
     * Mark publish + queue fan-out (does not notify users until batches run).
     *
     * @return array{build_id: string, version: string}
     */
    public function markPublished(int $postId, array $row): array
    {
        $build = OaaoBuildInfo::load();
        $buildId = trim((string) ($row['build_id'] ?? ''));
        if ($buildId === '') {
            $buildId = (string) ($build['build_id'] ?? 'unknown');
        }
        $version = trim((string) ($row['version'] ?? ''));
        if ($version === '') {
            $version = (string) ($build['version'] ?? '0.0.0');
        }

        $upd = $this->pdo->prepare(
            'UPDATE oaao_release_post SET status = ?, published_at = CURRENT_TIMESTAMP, build_id = ?, version = ?,
                fanout_status = ?, fanout_cursor_user_id = 0, fanout_notifications_total = 0,
                updated_at = CURRENT_TIMESTAMP WHERE release_post_id = ?',
        );
        $upd->execute(['published', $buildId, $version, 'pending', $postId]);

        return ['build_id' => $buildId, 'version' => $version];
    }

    /**
     * Process one fan-out batch.
     *
     * @return array{done: bool, created: int, total: int, cursor: int, status: string}
     */
    public function processBatch(int $postId, int $batchSize = self::BATCH_SIZE): array
    {
        $batchSize = max(50, min(1000, $batchSize));
        $row = $this->loadPost($postId);
        if ($row === null) {
            return ['done' => true, 'created' => 0, 'total' => 0, 'cursor' => 0, 'status' => 'missing'];
        }

        $status = (string) ($row['fanout_status'] ?? '');
        if ($status === 'done') {
            return [
                'done'   => true,
                'created'=> (int) ($row['fanout_notifications_total'] ?? 0),
                'total'  => (int) ($row['fanout_notifications_total'] ?? 0),
                'cursor' => (int) ($row['fanout_cursor_user_id'] ?? 0),
                'status' => 'done',
            ];
        }

        if ($status === '' || $status === 'pending') {
            $this->pdo->prepare(
                'UPDATE oaao_release_post SET fanout_status = ? WHERE release_post_id = ?',
            )->execute(['running', $postId]);
            $status = 'running';
        }

        $cursor = (int) ($row['fanout_cursor_user_id'] ?? 0);
        $title = trim((string) ($row['title'] ?? 'Release notes'));
        $notifyBody = mb_substr(trim((string) ($row['body_md'] ?? '')), 0, 280);
        $payload = [
            'release_post_id'  => $postId,
            'release_version'  => (string) ($row['version'] ?? ''),
            'release_build_id' => (string) ($row['build_id'] ?? ''),
            'release_slug'     => (string) ($row['slug'] ?? ''),
            'post_type'        => (string) ($row['post_type'] ?? 'changelog'),
        ];

        $repo = new NotificationRepository($this->pdo);
        $createdBatch = 0;

        $st = $this->pdo->prepare(
            'SELECT user_id FROM oaao_user WHERE disabled = 0 AND user_id > ? ORDER BY user_id ASC LIMIT ' . $batchSize,
        );
        $st->execute([$cursor]);
        $users = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $lastId = $cursor;
        foreach ($users as $u) {
            if (! \is_array($u)) {
                continue;
            }
            $uid = (int) ($u['user_id'] ?? 0);
            if ($uid < 1) {
                continue;
            }
            $lastId = $uid;
            if ($repo->create($uid, 'release', $title, $notifyBody !== '' ? $notifyBody : null, $payload) > 0) {
                ++$createdBatch;
            }
        }

        $total = (int) ($row['fanout_notifications_total'] ?? 0) + $createdBatch;
        $done = \count($users) < $batchSize;

        $newStatus = $done ? 'done' : 'running';
        $upd = $this->pdo->prepare(
            'UPDATE oaao_release_post SET fanout_cursor_user_id = ?, fanout_notifications_total = ?,
                fanout_status = ?, updated_at = CURRENT_TIMESTAMP WHERE release_post_id = ?',
        );
        $upd->execute([$lastId, $total, $newStatus, $postId]);

        return [
            'done'    => $done,
            'created' => $createdBatch,
            'total'   => $total,
            'cursor'  => $lastId,
            'status'  => $newStatus,
        ];
    }
}
