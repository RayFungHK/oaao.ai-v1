<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Resolve orchestrator sidecar base URL — keep in sync with {@see send.php} / {@see asr_transcribe.php}.
 */
final class OrchestratorInternalUrl
{
    public static function base(): string
    {
        $envInternal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
        if ($envInternal !== false && trim((string) $envInternal) !== '') {
            return rtrim(trim((string) $envInternal), '/');
        }
        if (getenv('OAAO_DOCKER') === '1') {
            return 'http://orchestrator:8103';
        }
        $port = getenv('OAAO_SIDECAR_PORT');
        if ($port !== false && (string) $port !== '') {
            return 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
        }
        if (@is_readable('/.dockerenv')) {
            return 'http://orchestrator:8103';
        }

        return '';
    }

    public static function sharedSecret(): ?string
    {
        $secret = getenv('OAAO_ORCH_SHARED_SECRET');
        if (\is_string($secret) && $secret !== '') {
            return $secret;
        }

        return null;
    }
}
