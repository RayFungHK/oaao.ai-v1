<?php

declare(strict_types=1);

require_once __DIR__ . '/MineRepository.php';
require_once __DIR__ . '/MineStorage.php';

function oaao_mine_data_root(): string
{
    $env = getenv('OAAO_MINE_DATA_ROOT');
    if ($env !== false && trim((string) $env) !== '') {
        return rtrim(trim((string) $env), '/\\');
    }

    return dirname(__DIR__, 6) . '/storage/mine';
}

function oaao_mine_relative_sqlite_path(int $tenantId, int $mineId): string
{
    return max(1, $tenantId) . '/' . max(1, $mineId) . '.sqlite';
}

function oaao_mine_compute_next_run_at(?int $intervalMinutes): ?string
{
    if ($intervalMinutes === null || $intervalMinutes < 1) {
        return null;
    }

    return gmdate('Y-m-d H:i:s', time() + ($intervalMinutes * 60));
}

/**
 * @return \oaaoai\endpoints\CanonicalEndpointsRepository|null
 */
function oaao_mine_endpoints_repo(object $controller): ?\oaaoai\endpoints\CanonicalEndpointsRepository
{
    $auth = $controller->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        return null;
    }
    require_once dirname(__DIR__, 3) . '/endpoints/default/library/CanonicalEndpointsRepository.php';
    require_once dirname(__DIR__, 3) . '/endpoints/default/library/LlmOrchestratorPayload.php';

    return new \oaaoai\endpoints\CanonicalEndpointsRepository($db, $controller->api('core'));
}

/**
 * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
 */
function oaao_mine_resolve_llm(object $controller): ?array
{
    $repo = oaao_mine_endpoints_repo($controller);
    if ($repo === null) {
        return null;
    }

    return \oaaoai\endpoints\LlmOrchestratorPayload::fromBinding(
        $repo->resolveMineBinding(),
        $controller->api('chat'),
    );
}
