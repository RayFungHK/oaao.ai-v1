<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * User personalization stored under {@code oaao_user.preferences_json.personalization}.
 *
 * Forwarded to the orchestrator on chat runs so the assistant can tailor replies
 * (profile, personal knowledge, local time, region).
 */
final class UserPersonalization
{
    /** @var list<string> */
    public const STRING_FIELDS = [
        'nickname',
        'occupation',
        'about_you',
        'custom_instructions',
        'knowledge',
        'timezone',
        'region',
    ];

    /** @var list<string> */
    public const BOOL_FIELDS = [
        'use_profile_in_chat',
        'use_knowledge_in_chat',
        'include_datetime_in_chat',
    ];

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'nickname'                  => '',
            'occupation'                => '',
            'about_you'                 => '',
            'custom_instructions'       => '',
            'knowledge'                 => '',
            'timezone'                  => 'UTC',
            'region'                    => '',
            'use_profile_in_chat'       => true,
            'use_knowledge_in_chat'     => true,
            'include_datetime_in_chat'  => true,
        ];
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, mixed>
     */
    public static function normalize(array $raw): array
    {
        $out = self::defaults();

        foreach (self::STRING_FIELDS as $key) {
            if (! \array_key_exists($key, $raw)) {
                continue;
            }
            $v = $raw[$key];
            if (! \is_string($v) && ! \is_numeric($v)) {
                continue;
            }
            $out[$key] = trim((string) $v);
        }

        foreach (self::BOOL_FIELDS as $key) {
            if (! \array_key_exists($key, $raw)) {
                continue;
            }
            $out[$key] = self::toBool($raw[$key], (bool) ($out[$key] ?? true));
        }

        if ($out['timezone'] === '') {
            $out['timezone'] = 'UTC';
        }

        return $out;
    }

    /**
     * @param array<string, mixed>|null $prefs decoded preferences_json root
     *
     * @return array<string, mixed>
     */
    public static function fromPreferences(?array $prefs): array
    {
        if ($prefs === null) {
            return self::defaults();
        }
        $block = $prefs['personalization'] ?? null;

        return self::normalize(\is_array($block) ? $block : []);
    }

    /**
     * @param array<string, mixed> $prefs
     * @param array<string, mixed> $patch
     *
     * @return array<string, mixed>
     */
    public static function mergeIntoPreferences(array $prefs, array $patch): array
    {
        $prefs['personalization'] = self::normalize(
            array_merge(self::fromPreferences($prefs), self::normalize($patch)),
        );

        return $prefs;
    }

    public static function loadForUser(\PDO $pdo, int $userId): array
    {
        if ($userId < 1) {
            return self::defaults();
        }

        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $raw = $stmt->fetchColumn();
        if (! \is_string($raw) || trim($raw) === '') {
            return self::defaults();
        }

        try {
            /** @var mixed $decoded */
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::defaults();
        }

        return self::fromPreferences(\is_array($decoded) ? $decoded : null);
    }

    /**
     * Strip empty strings; keep booleans for orchestrator toggles.
     *
     * @param array<string, mixed> $personalization
     *
     * @return array<string, mixed>
     */
    public static function forOrchestratorPayload(array $personalization): array
    {
        $norm = self::normalize($personalization);
        $out = [];
        foreach (self::STRING_FIELDS as $key) {
            $v = trim((string) ($norm[$key] ?? ''));
            if ($v !== '') {
                $out[$key] = $v;
            }
        }
        foreach (self::BOOL_FIELDS as $key) {
            $out[$key] = (bool) ($norm[$key] ?? true);
        }
        if (! isset($out['timezone'])) {
            $out['timezone'] = (string) ($norm['timezone'] ?? 'UTC');
        }

        return $out;
    }

    /** @return list<string> */
    public static function allowedTimezones(): array
    {
        return [
            'UTC',
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Los_Angeles',
            'America/Toronto',
            'America/Sao_Paulo',
            'Europe/London',
            'Europe/Paris',
            'Europe/Berlin',
            'Asia/Hong_Kong',
            'Asia/Taipei',
            'Asia/Shanghai',
            'Asia/Tokyo',
            'Asia/Singapore',
            'Asia/Seoul',
            'Asia/Dubai',
            'Australia/Sydney',
            'Pacific/Auckland',
        ];
    }

    private static function toBool(mixed $v, bool $default): bool
    {
        if (\is_bool($v)) {
            return $v;
        }
        if (\is_int($v) || \is_float($v)) {
            return (int) $v !== 0;
        }
        if (\is_string($v)) {
            $s = strtolower(trim($v));
            if (\in_array($s, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
            if (\in_array($s, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
        }

        return $default;
    }
}
