<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Published orchestrator HTTP bridge — consumed via {@code api('chat')} only (not cross-module require).
 */
final class ChatOrchestratorApi
{
    /**
     * @return array{0: string, 1: string} internal base URL, shared secret
     */
    public static function internalCredentials(): array
    {
        $base = OrchestratorInternalUrl::base();
        $secret = OrchestratorInternalUrl::sharedSecret();
        if ($secret === null || trim($secret) === '') {
            $env = getenv('OAAO_ORCH_SHARED_SECRET');
            $secret = ($env !== false && trim((string) $env) !== '')
                ? trim((string) $env)
                : 'oaao_dev_shared_secret';
        }

        return [$base, $secret];
    }

    public static function internalBase(): string
    {
        return self::internalCredentials()[0];
    }

    public static function sharedSecret(): string
    {
        return self::internalCredentials()[1];
    }

    /**
     * @param array<string, mixed>|null $payload
     *
     * @return array<string, mixed>|null
     */
    public static function postInternalJson(string $path, ?array $payload = null, int $timeoutSec = 45): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::postInternalJson($base, $secret, $path, $payload, $timeoutSec);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function getInternalJson(string $path, int $timeoutSec = 30): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::getInternalJson($base, $secret, $path, $timeoutSec);
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array{run_id: string, stream_token: string}|null
     */
    public static function startChatRun(array $payload): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::startChatRun($base, $secret, $payload);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function cancelChatRun(string $runId): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::cancelChatRun($base, $secret, $runId);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function resolveAgentAsk(string $runId, string $taskId, string $decision): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::resolveAgentAsk($base, $secret, $runId, $taskId, $decision);
    }

    /**
     * @param array<string, string> $funasrEnv
     *
     * @return array<string, mixed>|null
     */
    public static function ensureFunasr(bool $pull = true, array $funasrEnv = [], bool $recreate = false): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::ensureFunasr($base, $secret, $pull, $funasrEnv, $recreate);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function funasrStatus(): ?array
    {
        [$base, $secret] = self::internalCredentials();
        if ($base === '') {
            return null;
        }

        return OrchestratorSidecarClient::funasrStatus($base, $secret);
    }

    public static function inferApiKeyEnv(string $apiKeyRef): ?string
    {
        return ChatOrchestratorBootstrap::inferApiKeyEnv($apiKeyRef);
    }
}
