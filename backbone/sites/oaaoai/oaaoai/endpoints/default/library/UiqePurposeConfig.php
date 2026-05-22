<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * UIQE purpose → orchestrator post-stream worker payload (IQS / ACCS).
 */
final class UiqePurposeConfig
{
    /**
     * @param array<string, mixed> $uiqeBind
     * @param callable(string): (string|null) $inferApiKeyEnv
     *
     * @return array<string, mixed>
     */
    public static function jobPayloadFromBinding(array $uiqeBind, callable $inferApiKeyEnv): array
    {
        $aref = trim((string) ($uiqeBind['api_key_ref'] ?? ''));

        return [
            'purpose_key' => (string) ($uiqeBind['purpose_key'] ?? ''),
            'base_url'    => (string) ($uiqeBind['base_url'] ?? ''),
            'model'       => (string) ($uiqeBind['model'] ?? ''),
            'api_key_env' => ($aref !== '' ? $inferApiKeyEnv($aref) : null),
        ];
    }
}
