<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Per-model token estimates for context usage (chars/token heuristics until true tokenizer ships).
 */
final class ChatTokenEstimator
{
    public const PROFILE_DEFAULT = 'default';

    public const PROFILE_CLAUDE = 'claude';

    public const PROFILE_GPT = 'gpt';

    public const PROFILE_GEMINI = 'gemini';

    public const PROFILE_LLAMA = 'llama';

    /**
     * @param array{profile?: array<string, mixed>, endpoint?: array<string, mixed>}|null $binding
     */
    public static function resolveProfileFromBinding(?array $binding): string
    {
        if ($binding === null) {
            return self::PROFILE_DEFAULT;
        }

        $hay = '';
        foreach (['endpoint', 'profile'] as $bucket) {
            $row = $binding[$bucket] ?? null;
            if (! \is_array($row)) {
                continue;
            }
            foreach (['model', 'model_id', 'model_name', 'deployment', 'base_model'] as $key) {
                $v = trim((string) ($row[$key] ?? ''));
                if ($v !== '') {
                    $hay .= ' ' . $v;
                }
            }
            $raw = trim((string) ($row['config_json'] ?? ''));
            if ($raw !== '') {
                $hay .= ' ' . $raw;
            }
        }

        return self::resolveProfileFromModelHint($hay);
    }

    public static function resolveProfileFromModelHint(string $hint): string
    {
        $m = strtolower(trim($hint));
        if ($m === '') {
            return self::PROFILE_DEFAULT;
        }
        if (str_contains($m, 'claude') || str_contains($m, 'anthropic')) {
            return self::PROFILE_CLAUDE;
        }
        if (
            preg_match('/\bgpt[-_]?/i', $m) === 1
            || str_contains($m, 'openai')
            || preg_match('/\bo[134](?:-mini|-preview)?\b/i', $m) === 1
        ) {
            return self::PROFILE_GPT;
        }
        if (str_contains($m, 'gemini') || str_contains($m, 'google')) {
            return self::PROFILE_GEMINI;
        }
        if (
            str_contains($m, 'llama')
            || str_contains($m, 'mistral')
            || str_contains($m, 'qwen')
            || str_contains($m, 'deepseek')
        ) {
            return self::PROFILE_LLAMA;
        }

        return self::PROFILE_DEFAULT;
    }

    public static function charsPerToken(string $profile): float
    {
        return match ($profile) {
            self::PROFILE_CLAUDE => 3.5,
            self::PROFILE_GPT    => 3.25,
            self::PROFILE_GEMINI => 3.8,
            self::PROFILE_LLAMA  => 3.6,
            default              => 4.0,
        };
    }

    public static function estimateTokens(string $text, ?string $profile = null): int
    {
        $t = trim($text);
        if ($t === '') {
            return 0;
        }
        $prof = $profile !== null && $profile !== '' ? $profile : self::PROFILE_DEFAULT;
        $cpt = self::charsPerToken($prof);
        if ($cpt < 0.5) {
            $cpt = 4.0;
        }

        return max(1, (int) ceil(strlen($t) / $cpt));
    }

    /**
     * @param mixed $payload
     */
    public static function estimateJsonTokens(mixed $payload, ?string $profile = null): int
    {
        if ($payload === null) {
            return 0;
        }
        try {
            $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $json = (string) $payload;
        }

        return self::estimateTokens($json, $profile);
    }
}
