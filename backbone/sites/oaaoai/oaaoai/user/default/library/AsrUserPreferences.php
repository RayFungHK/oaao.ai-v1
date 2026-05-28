<?php

declare(strict_types=1);

namespace oaaoai\user;

use oaaoai\endpoints\AsrUserPreferenceRegister;

/**
 * Resolve ASR user preference registry visibility and stored values.
 */
final class AsrUserPreferences
{
    /**
     * @param object|null $endpointsApi {@code api('endpoints')} — Emitter proxy; do not use {@see method_exists()} here.
     */
    public static function isVisibleWhenConfigured(?object $endpointsApi, string $visibleWhen): bool
    {
        $key = trim($visibleWhen);
        if ($key === '') {
            return true;
        }
        if ($endpointsApi === null) {
            return false;
        }
        if ($key === 'polish_configured') {
            try {
                return (bool) $endpointsApi->isPolishPurposeConfigured();
            } catch (\Throwable) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param object|null $endpointsApi
     *
     * @return list<array<string, mixed>>
     */
    public static function visibleFields(?object $endpointsApi): array
    {
        return AsrUserPreferenceRegister::visibleFields(
            static fn (string $when): bool => self::isVisibleWhenConfigured($endpointsApi, $when),
        );
    }

    /**
     * @param array<string, mixed> $prefs
     * @param object|null          $endpointsApi
     *
     * @return array<string, string>
     */
    public static function valuesFromPreferences(array $prefs, ?object $endpointsApi): array
    {
        $all = AsrUserPreferenceRegister::valuesFromPreferences($prefs);
        $visibleKeys = [];
        foreach (self::visibleFields($endpointsApi) as $field) {
            $prefKey = trim((string) ($field['pref_key'] ?? ''));
            if ($prefKey !== '') {
                $visibleKeys[$prefKey] = true;
            }
        }
        $out = [];
        foreach ($all as $key => $value) {
            if (isset($visibleKeys[$key])) {
                $out[$key] = $value;
            }
        }

        return $out;
    }
}
