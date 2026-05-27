<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once dirname(__DIR__, 3) . '/chat/default/library/ChatOrchestratorApi.php';

use oaaoai\chat\ChatOrchestratorApi;

/**
 * HTTP bridge to orchestrator {@code /v1/admin/storage/*} for cloud blob I/O.
 */
final class StorageOrchestratorClient
{
    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>|null
     */
    public static function post(string $path, array $payload, int $timeoutSec = 120): ?array
    {
        return ChatOrchestratorApi::postInternalJson('/v1/admin/storage/' . ltrim($path, '/'), $payload, $timeoutSec);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function get(string $path, int $timeoutSec = 60): ?array
    {
        return ChatOrchestratorApi::getInternalJson('/v1/admin/storage/' . ltrim($path, '/'), $timeoutSec);
    }
}
