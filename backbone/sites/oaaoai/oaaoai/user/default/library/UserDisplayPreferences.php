<?php

declare(strict_types=1);

namespace oaaoai\user;

use oaaoai\endpoints\AsrUserPreferenceRegister;

/**
 * User display preferences stored at the root of {@code oaao_user.preferences_json}.
 */
final class UserDisplayPreferences
{
    public const DEFAULT_LOCALE = 'en';

    /**
     * @param array<string, mixed> $prefs
     *
     * @return array{locale: string, polish_style: string}
     */
    public static function fromPreferences(array $prefs): array
    {
        $locale = isset($prefs['locale']) && \is_string($prefs['locale'])
            ? trim($prefs['locale'])
            : '';
        if ($locale === '') {
            $locale = self::DEFAULT_LOCALE;
        }

        $polishStyle = AsrUserPreferenceRegister::normalizeValue(
            'polish_style',
            isset($prefs['polish_style']) && \is_string($prefs['polish_style']) ? $prefs['polish_style'] : null,
        );

        return [
            'locale'       => $locale,
            'polish_style' => $polishStyle,
        ];
    }

    public static function localeForUser(\PDO $pdo, int $userId): string
    {
        if ($userId < 1) {
            return self::DEFAULT_LOCALE;
        }

        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $raw = $stmt->fetchColumn();
        if (! \is_string($raw) || trim($raw) === '') {
            return self::DEFAULT_LOCALE;
        }

        try {
            /** @var mixed $decoded */
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::DEFAULT_LOCALE;
        }

        return self::fromPreferences(\is_array($decoded) ? $decoded : null)['locale'];
    }
}
