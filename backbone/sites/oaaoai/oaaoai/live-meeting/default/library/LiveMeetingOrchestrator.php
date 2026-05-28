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
    public static function sessionStop(
        object $chatApi,
        string $sessionId,
        bool $keepAudio,
        ?string $clientLiveText = null,
        ?array $clientLiveChunks = null,
        ?array $clientBatchChunks = null,
    ): ?array {
        $payload = [
            'session_id' => $sessionId,
            'keep_audio' => $keepAudio,
        ];
        $clientLiveText = trim((string) ($clientLiveText ?? ''));
        if ($clientLiveText !== '') {
            $payload['client_live_text'] = $clientLiveText;
        }
        $liveChunks = [];
        if (\is_array($clientLiveChunks)) {
            foreach ($clientLiveChunks as $chunk) {
                $line = trim((string) $chunk);
                if ($line !== '') {
                    $liveChunks[] = $line;
                }
            }
        }
        if ($liveChunks !== []) {
            $payload['client_live_chunks'] = $liveChunks;
        }
        $batchChunks = [];
        if (\is_array($clientBatchChunks)) {
            foreach ($clientBatchChunks as $chunk) {
                $line = trim((string) $chunk);
                if ($line !== '') {
                    $batchChunks[] = $line;
                }
            }
        }
        if ($batchChunks !== []) {
            $payload['client_batch_chunks'] = $batchChunks;
        }

        return $chatApi->postOrchestratorInternalJson('/v1/live/session_stop', $payload, 120);
    }

    public static function publicStreamBase(): string
    {
        if (! class_exists(\oaaoai\chat\OrchestratorPublicBase::class)) {
            $path = dirname(__DIR__, 3) . '/chat/default/library/OrchestratorPublicBase.php';
            if (is_readable($path)) {
                require_once $path;
            }
        }

        return \oaaoai\chat\OrchestratorPublicBase::fromEnv();
    }
}
