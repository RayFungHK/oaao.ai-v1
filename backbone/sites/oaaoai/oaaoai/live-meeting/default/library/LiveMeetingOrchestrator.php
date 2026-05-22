<?php

declare(strict_types=1);

namespace oaaoai\livemeeting;

/**
 * Internal JSON to Python orchestrator — live meeting sessions (no browser SSE via PHP).
 *
 * Requires {@code api('chat')} bridge — no cross-module require of chat libraries.
 */
final class LiveMeetingOrchestrator
{
    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>|null
     */
    public static function sessionStart(object $chatApi, array $payload): ?array
    {
        $resp = $chatApi->postOrchestratorInternalJson('/v1/live/session_start', $payload, 30);
        if (! \is_array($resp) || empty($resp['ok'])) {
            return null;
        }
        $data = $resp['data'] ?? null;

        return \is_array($data) ? $data : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function sessionStop(object $chatApi, string $sessionId, bool $keepAudio): ?array
    {
        return $chatApi->postOrchestratorInternalJson('/v1/live/session_stop', [
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
