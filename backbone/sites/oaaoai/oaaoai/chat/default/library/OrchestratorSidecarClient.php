<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Minimal HTTP client for the Python orchestrator (internal Docker network or localhost).
 */
final class OrchestratorSidecarClient
{
    /**
     * @return array<string, mixed>|null
     */
    public static function postInternalJson(string $baseUrl, string $sharedSecret, string $path, ?array $payload = null, int $timeoutSec = 45): ?array
    {
        $baseUrl = rtrim($baseUrl, '/');
        $path = '/' . ltrim($path, '/');
        $url = $baseUrl . $path;
        $body = $payload !== null
            ? json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
            : '{}';

        $http = self::rawPostWithStatus($url, $sharedSecret, $body, $timeoutSec);
        if ($http === null) {
            return null;
        }

        $code = (int) ($http['code'] ?? 0);
        $raw = (string) ($http['body'] ?? '');

        try {
            /** @var mixed $j */
            $j = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return $code >= 200 && $code < 300 ? null : ['ok' => false, 'detail' => 'invalid_response'];
        }

        if (! \is_array($j)) {
            return null;
        }

        if ($code < 200 || $code >= 300) {
            $j['ok'] = false;
            if (! isset($j['detail']) && isset($j['message'])) {
                $j['detail'] = (string) $j['message'];
            }
            if (! isset($j['detail'])) {
                $j['detail'] = 'orchestrator_error';
            }

            return $j;
        }

        return $j;
    }

    /**
     * Built-in FunASR — pull/start (when compose enabled) + smoke test.
     *
     * @param array<string, string> $funasrEnv Docker Compose env overrides (adapter mode, spk model, …)
     *
     * @return array<string, mixed>|null
     */
    public static function ensureFunasr(string $baseUrl, string $sharedSecret, bool $pull = true, array $funasrEnv = []): ?array
    {
        $body = ['pull' => $pull];
        if ($funasrEnv !== []) {
            $body['funasr_env'] = $funasrEnv;
        }

        return self::postInternalJson($baseUrl, $sharedSecret, '/v1/funasr/ensure', $body, 660);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function funasrStatus(string $baseUrl, string $sharedSecret): ?array
    {
        return self::getInternalJson($baseUrl, $sharedSecret, '/v1/funasr/status', 30);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function getInternalJson(string $baseUrl, string $sharedSecret, string $path, int $timeoutSec = 30): ?array
    {
        $baseUrl = rtrim($baseUrl, '/');
        $path = '/' . ltrim($path, '/');
        $url = $baseUrl . $path;

        if (\function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return null;
            }
            curl_setopt_array($ch, [
                \CURLOPT_HTTPHEADER      => [
                    'Accept: application/json',
                    'X-OAAO-Internal-Token: ' . $sharedSecret,
                ],
                \CURLOPT_RETURNTRANSFER  => true,
                \CURLOPT_CONNECTTIMEOUT  => 8,
                \CURLOPT_TIMEOUT         => max(8, $timeoutSec),
            ]);
            $raw = curl_exec($ch);
            $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($raw === false || $code < 200 || $code >= 300) {
                return null;
            }
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'method'  => 'GET',
                    'header'  => "Accept: application/json\r\nX-OAAO-Internal-Token: {$sharedSecret}\r\n",
                    'timeout' => max(8, $timeoutSec),
                ],
            ]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) {
                return null;
            }
        }

        try {
            /** @var mixed $j */
            $j = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return null;
        }

        return \is_array($j) ? $j : null;
    }

    private static function rawPost(string $url, string $sharedSecret, string $body, int $timeoutSec): ?string
    {
        if (\function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return null;
            }
            curl_setopt_array($ch, [
                \CURLOPT_POST            => true,
                \CURLOPT_HTTPHEADER      => [
                    'Content-Type: application/json',
                    'Accept: application/json',
                    'X-OAAO-Internal-Token: ' . $sharedSecret,
                ],
                \CURLOPT_POSTFIELDS      => $body,
                \CURLOPT_RETURNTRANSFER  => true,
                \CURLOPT_CONNECTTIMEOUT  => 8,
                \CURLOPT_TIMEOUT         => max(15, $timeoutSec),
            ]);
            $raw = curl_exec($ch);
            $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($raw === false || $code < 200 || $code >= 300) {
                return null;
            }

            return \is_string($raw) ? $raw : null;
        }

        $ctx = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nAccept: application/json\r\nX-OAAO-Internal-Token: {$sharedSecret}\r\n",
                'content' => $body,
                'timeout' => max(15, $timeoutSec),
            ],
        ]);
        $raw = @file_get_contents($url, false, $ctx);

        return $raw === false ? null : $raw;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array{run_id: string, stream_token: string}|null
     */
    public static function startChatRun(string $baseUrl, string $sharedSecret, array $payload): ?array
    {
        $j = self::postInternalJson($baseUrl, $sharedSecret, '/v1/runs/chat', $payload, 45);
        if ($j === null) {
            return null;
        }
        $rid = isset($j['run_id']) ? trim((string) $j['run_id']) : '';
        $tok = isset($j['stream_token']) ? trim((string) $j['stream_token']) : '';
        if ($rid === '' || $tok === '') {
            return null;
        }

        return ['run_id' => $rid, 'stream_token' => $tok];
    }

    /**
     * Cooperative cancel — marks the buffered {@code StreamRun} for unwind (does not kill the asyncio task).
     *
     * @return array<string, mixed>|null
     */
    /**
     * Resume a run blocked on {@code agent_ask} (proceed or skip).
     *
     * @return array<string, mixed>|null
     */
    public static function resolveAgentAsk(
        string $baseUrl,
        string $sharedSecret,
        string $runId,
        string $taskId,
        string $decision,
    ): ?array {
        $runId = trim($runId);
        $taskId = trim($taskId);
        $decision = strtolower(trim($decision));
        if ($runId === '' || $taskId === '' || ! \in_array($decision, ['proceed', 'skip'], true)) {
            return null;
        }

        $url = rtrim($baseUrl, '/') . '/v1/runs/' . rawurlencode($runId) . '/agent_ask';
        $body = json_encode(
            [
                'task_id'  => $taskId,
                'decision' => $decision,
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
        $result = self::rawPostWithStatus($url, $sharedSecret, $body, 15);
        if ($result === null) {
            return ['ok' => false, 'detail' => 'orchestrator_unreachable'];
        }
        $code = (int) ($result['code'] ?? 0);
        $raw = (string) ($result['body'] ?? '');
        if ($code === 404) {
            return ['ok' => false, 'detail' => 'no_pending_ask'];
        }
        if ($code < 200 || $code >= 300) {
            return ['ok' => false, 'detail' => 'orchestrator_error'];
        }
        try {
            /** @var mixed $j */
            $j = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return ['ok' => false, 'detail' => 'invalid_response'];
        }

        return \is_array($j) ? $j : ['ok' => false, 'detail' => 'invalid_response'];
    }

    /**
     * @return array{code: int, body: string}|null
     */
    private static function rawPostWithStatus(string $url, string $sharedSecret, string $body, int $timeoutSec): ?array
    {
        if (! \function_exists('curl_init')) {
            return null;
        }
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            \CURLOPT_POST            => true,
            \CURLOPT_HTTPHEADER      => [
                'Content-Type: application/json',
                'Accept: application/json',
                'X-OAAO-Internal-Token: ' . $sharedSecret,
            ],
            \CURLOPT_POSTFIELDS      => $body,
            \CURLOPT_RETURNTRANSFER  => true,
            \CURLOPT_CONNECTTIMEOUT  => 8,
            \CURLOPT_TIMEOUT         => max(15, $timeoutSec),
        ]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false) {
            return null;
        }

        return ['code' => $code, 'body' => \is_string($raw) ? $raw : ''];
    }

    public static function cancelChatRun(string $baseUrl, string $sharedSecret, string $runId): ?array
    {
        $runId = trim($runId);
        if ($runId === '') {
            return null;
        }

        return self::postInternalJson(
            $baseUrl,
            $sharedSecret,
            '/v1/runs/' . rawurlencode($runId) . '/cancel',
            null,
            15,
        );
    }
}
