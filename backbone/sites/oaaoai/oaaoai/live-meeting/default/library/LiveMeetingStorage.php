<?php

declare(strict_types=1);

namespace oaaoai\livemeeting;

/**
 * Session directories under {@code OAAO_LIVE_MEETING_ROOT} (shared with orchestrator bind mount).
 */
final class LiveMeetingStorage
{
    public static function root(): string
    {
        $raw = getenv('OAAO_LIVE_MEETING_ROOT');
        if (\is_string($raw) && trim($raw) !== '') {
            return rtrim(trim($raw), '/');
        }

        return '/var/www/html/sites/oaaoai/oaaoai/data/live-meeting';
    }

    public static function sessionDir(string $sessionId): string
    {
        $sid = preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId) ?? '';
        if ($sid === '') {
            throw new \InvalidArgumentException('invalid session_id');
        }

        return self::root() . '/sessions/' . $sid;
    }

    public static function ensureSessionTree(string $sessionId): void
    {
        $base = self::sessionDir($sessionId);
        if (! is_dir($base) && ! mkdir($base, 0775, true) && ! is_dir($base)) {
            throw new \RuntimeException('could not create live meeting session directory');
        }
        $audio = $base . '/audio';
        if (! is_dir($audio) && ! mkdir($audio, 0775, true) && ! is_dir($audio)) {
            throw new \RuntimeException('could not create live meeting audio directory');
        }
    }
}
