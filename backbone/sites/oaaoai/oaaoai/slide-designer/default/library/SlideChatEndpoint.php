<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

use oaaoai\chat\ChatOrchestratorBootstrap;

/**
 * Resolve chat LLM endpoint payload for slide-designer orchestrator calls.
 */
final class SlideChatEndpoint
{
    /**
     * @return array<string, mixed>|null
     */
    public static function resolvePayload(?\Razy\Database $canonDb, int $chatEndpointId = 0): ?array
    {
        if (! $canonDb instanceof \Razy\Database) {
            return null;
        }

        $binding = $chatEndpointId > 0
            ? ChatOrchestratorBootstrap::resolveBindingForProfile($canonDb, $chatEndpointId)
            : ChatOrchestratorBootstrap::resolveDefaultBinding($canonDb);
        if ($binding === null) {
            return null;
        }

        $endpointRow = $binding['endpoint'];

        return [
            'endpoint_ref' => trim((string) ($endpointRow['name'] ?? '')),
            'base_url'     => trim((string) ($endpointRow['base_url'] ?? '')),
            'model'        => trim((string) ($endpointRow['model'] ?? '')),
            'api_key_env'  => ChatOrchestratorBootstrap::inferApiKeyEnv(
                isset($endpointRow['api_key_ref']) ? (string) $endpointRow['api_key_ref'] : null
            ),
        ];
    }
}
