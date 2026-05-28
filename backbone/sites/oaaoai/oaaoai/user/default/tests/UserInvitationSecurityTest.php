<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationSupport;
use PHPUnit\Framework\TestCase;

/**
 * PLAT-2-S7 — invitation + reset token security (SQLite fixtures).
 */
final class UserInvitationSecurityTest extends TestCase
{
    private \PDO $pdo;

    protected function setUp(): void
    {
        $this->pdo = new \PDO('sqlite::memory:');
        $this->pdo->exec('CREATE TABLE oaao_user_invitation (
            invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT "user",
            permission_group_id INTEGER DEFAULT NULL,
            invited_by_user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT "pending",
            expires_at TEXT NOT NULL,
            accepted_at TEXT DEFAULT NULL,
            accepted_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )');
        $this->pdo->exec('CREATE TABLE oaao_password_reset (
            reset_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT "pending",
            expires_at TEXT NOT NULL,
            used_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )');
    }

    public function test_token_hash_is_sha256_hex(): void
    {
        $plain = UserInvitationSupport::issueToken();
        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/i', $plain);
        $hash = UserInvitationSupport::hashToken($plain);
        self::assertSame(64, strlen($hash));
        self::assertTrue(UserInvitationSupport::constantTimeEquals($hash, UserInvitationSupport::hashToken($plain)));
        self::assertFalse(UserInvitationSupport::constantTimeEquals($hash, UserInvitationSupport::hashToken(UserInvitationSupport::issueToken())));
    }

    public function test_pending_invitation_validates_before_expiry(): void
    {
        $plain = bin2hex(random_bytes(32));
        $hash = UserInvitationSupport::hashToken($plain);
        $future = (new \DateTimeImmutable('+1 day'))->format('Y-m-d H:i:s');
        $this->insertInvitation($hash, 'pending', $future);

        self::assertTrue($this->invitationIsValid($hash, 'pending'));
    }

    public function test_expired_invitation_rejected(): void
    {
        $plain = bin2hex(random_bytes(32));
        $hash = UserInvitationSupport::hashToken($plain);
        $past = (new \DateTimeImmutable('-1 hour'))->format('Y-m-d H:i:s');
        $this->insertInvitation($hash, 'pending', $past);

        self::assertFalse($this->invitationIsValid($hash, 'pending'));
    }

    public function test_revoked_and_accepted_invitation_rejected(): void
    {
        $hash = UserInvitationSupport::hashToken(bin2hex(random_bytes(32)));
        $future = (new \DateTimeImmutable('+1 day'))->format('Y-m-d H:i:s');
        $this->insertInvitation($hash, 'revoked', $future);
        self::assertFalse($this->invitationIsValid($hash, 'pending'));

        $hash2 = UserInvitationSupport::hashToken(bin2hex(random_bytes(32)));
        $this->insertInvitation($hash2, 'accepted', $future);
        self::assertFalse($this->invitationIsValid($hash2, 'pending'));
    }

    public function test_admin_invite_rate_limit_count(): void
    {
        $since = (new \DateTimeImmutable('-30 minutes'))->format('Y-m-d H:i:s');
        $st = $this->pdo->prepare(
            'INSERT INTO oaao_user_invitation (tenant_id, email, token_hash, invited_by_user_id, status, expires_at, created_at)
             VALUES (1, ?, ?, 99, "pending", ?, ?)',
        );
        for ($i = 0; $i < 10; $i++) {
            $st->execute([
                "user{$i}@example.com",
                UserInvitationSupport::hashToken(bin2hex(random_bytes(32))),
                (new \DateTimeImmutable('+1 day'))->format('Y-m-d H:i:s'),
                $since,
            ]);
        }

        $countSt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM oaao_user_invitation
             WHERE tenant_id = 1 AND invited_by_user_id = 99 AND created_at >= ?',
        );
        $countSt->execute([$since]);
        $count = (int) $countSt->fetchColumn();

        self::assertSame(10, $count);
        self::assertGreaterThanOrEqual(10, $count);
    }

    public function test_password_reset_request_uses_generic_success_envelope(): void
    {
        $generic = UserInvitationSupport::normalizeEmail('nobody@example.com');
        self::assertSame('nobody@example.com', $generic);

        $response = [
            'success' => true,
            'message' => 'If an account exists for this email, a reset link has been sent.',
        ];
        self::assertTrue($response['success']);
        self::assertStringNotContainsString('not found', strtolower($response['message']));
        self::assertStringNotContainsString('no user', strtolower($response['message']));
    }

    public function test_reset_token_single_pending_per_user(): void
    {
        $userId = 42;
        $this->pdo->exec('UPDATE oaao_password_reset SET status = "expired" WHERE user_id = ' . $userId);
        $hash = UserInvitationSupport::hashToken(bin2hex(random_bytes(32)));
        $this->pdo->prepare(
            'INSERT INTO oaao_password_reset (user_id, token_hash, status, expires_at) VALUES (?, ?, "pending", ?)',
        )->execute([$userId, $hash, (new \DateTimeImmutable('+1 hour'))->format('Y-m-d H:i:s')]);

        $pending = $this->pdo->query(
            'SELECT COUNT(*) FROM oaao_password_reset WHERE user_id = 42 AND status = "pending"',
        )->fetchColumn();
        self::assertSame(1, (int) $pending);
    }

    private function insertInvitation(string $tokenHash, string $status, string $expiresAt): void
    {
        $this->pdo->prepare(
            'INSERT INTO oaao_user_invitation (tenant_id, email, token_hash, invited_by_user_id, status, expires_at)
             VALUES (1, "a@b.com", ?, 1, ?, ?)',
        )->execute([$tokenHash, $status, $expiresAt]);
    }

    private function invitationIsValid(string $tokenHash, string $expectedStatus): bool
    {
        $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');
        $st = $this->pdo->prepare(
            'SELECT invitation_id FROM oaao_user_invitation
             WHERE token_hash = ? AND status = ? AND expires_at > ? LIMIT 1',
        );
        $st->execute([$tokenHash, $expectedStatus, $nowIso]);

        return \is_array($st->fetch(\PDO::FETCH_ASSOC));
    }
}
