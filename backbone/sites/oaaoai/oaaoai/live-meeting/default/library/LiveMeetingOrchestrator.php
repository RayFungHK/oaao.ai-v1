<?php

declare(strict_types=1);

namespace oaaoai\livemeeting;

require_once dirname(__DIR__, 3) . '/chat/default/library/OrchestratorInternalUrl.php';
require_once dirname(__DIR__, 3) . '/chat/default/library/OrchestratorSidecarClient.php';

use oaaoai\chat\OrchestratorInternalUrl;
use oaaoai\chat\OrchestratorSidecarClient;

/**
 * Internal JSON to Python orchestrator — live meeting sessions (no browser SSE via PHP).
 */
final class LiveMeetingOrchestrator
{
    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>|null
     */
    public static function sessionStart(array $payload): ?array
    {
        $base = OrchestratorInternalUrl::base();
        $secret = OrchestratorInternalUrl::sharedSecret();
        if ($base === '' || $secret === null) {
            return null;
        }

        $resp = OrchestratorSidecarClient::postInternalJson($base, $secret, '/v1/live/session_start', $payload, 30);
        if (! \is_array($resp) || empty($resp['ok'])) {
            return null;
        }
        $data = $resp['data'] ?? null;

        return \is_array($data) ? $data : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function sessionStop(string $sessionId, bool $keepAudio): ?array
    {
        $base = OrchestratorInternalUrl::base();
        $secret = OrchestratorInternalUrl::sharedSecret();
        if ($base === '' || $secret === null) {
            return null;
        }

        return OrchestratorSidecarClient::postInternalJson($base, $secret, '/v1/live/session_stop', [
            'session_id' => $sessionId,
            'keep_audio' => $keepAudio,
        ], 30);
    }

    public static function publicStreamBase(): string
    {
        $raw = getenv('OAAO_ORCHESTRATOR_PUBLIC_BASE');
        if (\is_string($raw) && trim($raw) !== '') {
            return rtrim(trim($raw), '/');
        }
        $port = getenv('OAAO_SIDECAR_PORT');
        if ($port !== false && (string) $port !== '') {
            return 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
        }

        return '';
    }
}
