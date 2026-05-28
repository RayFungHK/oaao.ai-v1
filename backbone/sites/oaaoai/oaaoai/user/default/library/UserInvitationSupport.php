<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * Tenant invitation + password reset helpers (EPIC-PLAT-2).
 */
final class UserInvitationSupport
{
    public const INVITE_TTL_HOURS = 72;

    public const RESET_TTL_HOURS = 1;

    public static function normalizeEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    public static function issueToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public static function hashToken(string $plainToken): string
    {
        return hash('sha256', $plainToken);
    }

    public static function constantTimeEquals(string $a, string $b): bool
    {
        if ($a === '' || $b === '') {
            return false;
        }

        return hash_equals($a, $b);
    }

    public static function appBaseUrl(): string
    {
        $scheme = (! empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = trim((string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        $prefix = defined('RELATIVE_ROOT') ? (string) RELATIVE_ROOT : '';
        $prefix = rtrim($prefix, '/');

        return $scheme . '://' . $host . $prefix;
    }

    public static function inviteRegisterUrl(string $plainToken): string
    {
        return self::appBaseUrl() . '/user/register?token=' . rawurlencode($plainToken);
    }

    public static function resetPasswordUrl(string $plainToken): string
    {
        return self::appBaseUrl() . '/user/reset-password?token=' . rawurlencode($plainToken);
    }

    /**
     * @return array{sent: bool, logged: bool, error: string|null}
     */
    public static function sendMail(string $to, string $subject, string $bodyText): array
    {
        $enabled = getenv('OAAO_MAIL_ENABLED');
        if ($enabled === false || $enabled === '' || $enabled === '0') {
            error_log('[oaao-user-invite] mail skipped (OAAO_MAIL_ENABLED off) to=' . $to . ' subject=' . $subject);

            return ['sent' => false, 'logged' => true, 'error' => null];
        }

        $from = trim((string) (getenv('OAAO_MAIL_FROM') ?: 'noreply@oaao.local'));
        $headers = 'From: ' . $from . "\r\n" . 'Content-Type: text/plain; charset=UTF-8';
        $ok = @mail($to, $subject, $bodyText, $headers);
        if (! $ok) {
            error_log('[oaao-user-invite] mail() failed to=' . $to);

            return ['sent' => false, 'logged' => false, 'error' => 'mail delivery failed'];
        }

        return ['sent' => true, 'logged' => false, 'error' => null];
    }

    public static function inviteExpiresAt(): string
    {
        return (new \DateTimeImmutable('+' . self::INVITE_TTL_HOURS . ' hours'))->format('Y-m-d H:i:s');
    }

    public static function resetExpiresAt(): string
    {
        return (new \DateTimeImmutable('+' . self::RESET_TTL_HOURS . ' hours'))->format('Y-m-d H:i:s');
    }

    /**
     * @param \Razy\Database $db
     */
    public static function countRecentInvitesByAdmin($db, int $tenantId, int $adminUserId, int $withinHours = 1): int
    {
        $since = (new \DateTimeImmutable('-' . max(1, $withinHours) . ' hours'))->format('Y-m-d H:i:s');
        $row = $db->prepare()
            ->select('COUNT(*) AS c')
            ->from('user_invitation')
            ->where('tenant_id=:tid, invited_by_user_id=:uid, created_at>=:since')
            ->assign([
                'tid'   => $tenantId,
                'uid'   => $adminUserId,
                'since' => $since,
            ])
            ->query()
            ->fetch();

        return \is_array($row) ? (int) ($row['c'] ?? 0) : 0;
    }
}
