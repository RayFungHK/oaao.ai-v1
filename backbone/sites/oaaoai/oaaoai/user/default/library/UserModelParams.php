<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * UX-1 — per-user LLM sampling overrides under {@code preferences_json.model_params}.
 */
final class UserModelParams
{
    public const VERSION = 1;

    /** @return array<string, int|float|null> */
    public static function defaults(): array
    {
        return [
            'version'           => self::VERSION,
            'temperature'       => null,
            'top_p'             => null,
            'top_k'             => null,
            'presence_penalty'  => null,
            'frequency_penalty' => null,
            'max_tokens'        => null,
        ];
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, int|float|null>
     */
    public static function normalize(array $raw): array
    {
        $out = self::defaults();
        $out['version'] = self::VERSION;

        if (isset($raw['temperature']) && is_numeric($raw['temperature'])) {
            $out['temperature'] = max(0.0, min(2.0, (float) $raw['temperature']));
        }
        if (isset($raw['top_p']) && is_numeric($raw['top_p'])) {
            $out['top_p'] = max(0.0, min(1.0, (float) $raw['top_p']));
        }
        if (isset($raw['top_k']) && is_numeric($raw['top_k'])) {
            $out['top_k'] = max(1, min(200, (int) $raw['top_k']));
        }
        if (isset($raw['presence_penalty']) && is_numeric($raw['presence_penalty'])) {
            $out['presence_penalty'] = max(-2.0, min(2.0, (float) $raw['presence_penalty']));
        }
        if (isset($raw['frequency_penalty']) && is_numeric($raw['frequency_penalty'])) {
            $out['frequency_penalty'] = max(-2.0, min(2.0, (float) $raw['frequency_penalty']));
        }
        if (isset($raw['max_tokens']) && is_numeric($raw['max_tokens'])) {
            $out['max_tokens'] = max(1, min(128_000, (int) $raw['max_tokens']));
        }

        return $out;
    }

    /**
     * @param array<string, mixed>|null $prefs
     *
     * @return array<string, int|float|null>
     */
    public static function fromPreferences(?array $prefs): array
    {
        if ($prefs === null) {
            return self::defaults();
        }
        $block = $prefs['model_params'] ?? null;

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
        $prefs['model_params'] = self::normalize(
            array_merge(self::fromPreferences($prefs), self::normalize($patch)),
        );

        return $prefs;
    }

    /**
     * @param array<string, int|float|null> $params
     *
     * @return array<string, float|int>
     */
    public static function activeOverrides(array $params): array
    {
        $out = [];
        foreach (['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'max_tokens'] as $key) {
            if (! \array_key_exists($key, $params) || $params[$key] === null) {
                continue;
            }
            $out[$key] = $params[$key];
        }

        return $out;
    }

    /**
     * Merge layers left→right; later non-null keys win (purpose → user → thread).
     *
     * @param list<array<string, int|float|null>> $layers
     *
     * @return array<string, int|float>
     */
    public static function mergeLayers(array $layers): array
    {
        $merged = self::defaults();
        foreach ($layers as $layer) {
            if (! \is_array($layer) || $layer === []) {
                continue;
            }
            $norm = self::normalize($layer);
            foreach (['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'max_tokens'] as $key) {
                if (\array_key_exists($key, $norm) && $norm[$key] !== null) {
                    $merged[$key] = $norm[$key];
                }
            }
        }

        return self::activeOverrides($merged);
    }

    /**
     * @param array<string, mixed>|null $paramsJson conversation params_json fragment
     *
     * @return array<string, int|float|null>
     */
    public static function fromConversationParams(?array $paramsJson): array
    {
        if ($paramsJson === null || $paramsJson === []) {
            return self::defaults();
        }
        $block = $paramsJson['model_params'] ?? null;

        return self::normalize(\is_array($block) ? $block : []);
    }

    public static function loadForUser(\PDO $pdo, int $userId): array
    {
        if ($userId < 1) {
            return self::defaults();
        }

        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $raw = $stmt->fetchColumn();
        if (! \is_string($raw) || $raw === '') {
            return self::defaults();
        }
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::defaults();
        }

        return self::fromPreferences(\is_array($decoded) ? $decoded : null);
    }
}
