<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Build orchestrator-facing LLM config arrays from purpose bindings.
 */
final class LlmOrchestratorPayload
{
    /**
     * @param array<string, mixed>|null $bind from {@see CanonicalEndpointsRepository} resolvers
     * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
     */
    public static function fromBinding(?array $bind, ?object $chatApi): ?array
    {
        if ($bind === null) {
            return null;
        }
        $bu = trim((string) ($bind['base_url'] ?? ''));
        $model = trim((string) ($bind['model'] ?? ''));
        if ($bu === '' || $model === '') {
            return null;
        }
        $pref = trim((string) ($bind['api_key_ref'] ?? ''));
        $apiKeyEnv = null;
        if ($pref !== '' && $chatApi !== null && method_exists($chatApi, 'inferOrchestratorApiKeyEnv')) {
            $apiKeyEnv = $chatApi->inferOrchestratorApiKeyEnv($pref);
        }

        $out = [
            'purpose_key' => (string) ($bind['purpose_key'] ?? ''),
            'base_url'    => $bu,
            'model'       => $model,
            'api_key_env' => $apiKeyEnv,
        ];
        $cfg = \is_array($bind['endpoint_config'] ?? null) ? $bind['endpoint_config'] : [];
        foreach (['max_model_len', 'max_output_tokens', 'max_tokens', 'timeout_sec'] as $key) {
            if (! isset($cfg[$key]) || ! is_numeric($cfg[$key])) {
                continue;
            }
            $outKey = $key === 'max_tokens' ? 'max_output_tokens' : $key;
            $out[$outKey] = $key === 'timeout_sec' ? (float) $cfg[$key] : (int) $cfg[$key];
        }

        return $out;
    }
}
