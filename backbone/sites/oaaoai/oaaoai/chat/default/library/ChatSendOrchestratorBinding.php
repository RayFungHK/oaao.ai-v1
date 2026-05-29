<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Resolves orchestrator endpoint binding and internal sidecar base URL for chat send.
 */
final class ChatSendOrchestratorBinding
{
    public static function resolveInternalBase(): string
    {
        $internalBase = '';
        $envInternal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
        if ($envInternal !== false && trim((string) $envInternal) !== '') {
            $internalBase = rtrim(trim((string) $envInternal), '/');
        } elseif (getenv('OAAO_DOCKER') === '1') {
            $internalBase = 'http://orchestrator:8103';
        } else {
            $port = getenv('OAAO_SIDECAR_PORT');
            if ($port !== false && (string) $port !== '') {
                $internalBase = 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
            }
        }
        if ($internalBase === '' && @is_readable('/.dockerenv')) {
            $internalBase = 'http://orchestrator:8103';
        }

        return $internalBase;
    }

    /**
     * @return array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float, max_tokens?: int}|null
     */
    public static function resolveBinding(\Razy\Database $canonDb, int $chatEndpointId): ?array
    {
        if ($chatEndpointId > 0) {
            $binding = ChatOrchestratorBootstrap::resolveBindingForProfile($canonDb, $chatEndpointId);
            if ($binding !== null) {
                return $binding;
            }
        }

        return ChatOrchestratorBootstrap::resolveDefaultBinding($canonDb);
    }

    /**
     * @param array<string, mixed>|null $binding
     */
    public static function isReady(?array $binding, string $internalBase): bool
    {
        return $binding !== null && $internalBase !== '';
    }
}
