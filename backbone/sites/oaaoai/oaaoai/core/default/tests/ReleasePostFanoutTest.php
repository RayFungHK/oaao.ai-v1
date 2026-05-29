<?php

declare(strict_types=1);

use Oaaoai\Core\ReleasePostFanout;
use PHPUnit\Framework\TestCase;

/**
 * PLAT-1-S10 — publish + batched notification fan-out (SQLite fixture).
 */
final class ReleasePostFanoutTest extends TestCase
{
    private \PDO $pdo;

    protected function setUp(): void
    {
        $this->pdo = new \PDO('sqlite::memory:');
        $this->pdo->exec('CREATE TABLE oaao_user (
            user_id INTEGER PRIMARY KEY,
            disabled INTEGER NOT NULL DEFAULT 0
        )');
        $this->pdo->exec('CREATE TABLE oaao_release_post (
            release_post_id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL DEFAULT "",
            post_type TEXT NOT NULL DEFAULT "news",
            locale TEXT NOT NULL DEFAULT "en",
            version TEXT NOT NULL DEFAULT "",
            build_id TEXT NOT NULL DEFAULT "",
            title TEXT NOT NULL DEFAULT "",
            body_md TEXT NOT NULL DEFAULT "",
            status TEXT NOT NULL DEFAULT "draft",
            published_at TEXT,
            fanout_status TEXT NOT NULL DEFAULT "",
            fanout_cursor_user_id INTEGER NOT NULL DEFAULT 0,
            fanout_notifications_total INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )');
        $this->pdo->exec('CREATE TABLE oaao_notification (
            notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL DEFAULT "system",
            title TEXT NOT NULL,
            body TEXT,
            payload_json TEXT,
            read_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )');

        for ($i = 1; $i <= 5; ++$i) {
            $this->pdo->exec('INSERT INTO oaao_user (user_id, disabled) VALUES (' . $i . ', 0)');
        }
        $this->pdo->exec('INSERT INTO oaao_user (user_id, disabled) VALUES (6, 1)');

        $this->pdo->exec(
            'INSERT INTO oaao_release_post (slug, post_type, locale, title, body_md, status)
             VALUES ("test-post", "news", "en", "Test release", "Body", "draft")',
        );
    }

    public function test_fanout_creates_notifications_per_active_user(): void
    {
        $fanout = new ReleasePostFanout($this->pdo);
        $row = $fanout->loadPost(1);
        self::assertIsArray($row);

        $fanout->markPublished(1, $row);
        $totalCreated = 0;
        $guard = 0;
        do {
            $batch = $fanout->processBatch(1, 2);
            $totalCreated += (int) ($batch['created'] ?? 0);
            ++$guard;
        } while (! ($batch['done'] ?? true) && $guard < 20);

        self::assertTrue($batch['done'] ?? false);
        self::assertSame(5, (int) ($batch['total'] ?? 0));

        $count = (int) $this->pdo->query('SELECT COUNT(*) FROM oaao_notification WHERE kind = "release"')->fetchColumn();
        self::assertSame(5, $count);

        $payload = $this->pdo->query('SELECT payload_json FROM oaao_notification LIMIT 1')->fetchColumn();
        self::assertIsString($payload);
        $decoded = json_decode($payload, true);
        self::assertIsArray($decoded);
        self::assertSame(1, (int) ($decoded['release_post_id'] ?? 0));
    }
}
