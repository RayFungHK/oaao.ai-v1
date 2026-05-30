<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Productivity post-turn classifier LLM bindings ({@code productivity.calendar.*}, {@code productivity.todo.*}).
 */
final class ProductivityPurposeConfig
{
    /**
     * @param array<string, mixed> $bind
     * @param callable(string): (string|null) $inferApiKeyEnv
     *
     * @return array<string, mixed>
     */
    public static function jobPayloadFromBinding(array $bind, callable $inferApiKeyEnv): array
    {
        $aref = trim((string) ($bind['api_key_ref'] ?? ''));

        return [
            'purpose_key' => (string) ($bind['purpose_key'] ?? ''),
            'base_url'    => (string) ($bind['base_url'] ?? ''),
            'model'       => (string) ($bind['model'] ?? ''),
            'api_key_env' => ($aref !== '' ? $inferApiKeyEnv($aref) : null),
        ];
    }
}
