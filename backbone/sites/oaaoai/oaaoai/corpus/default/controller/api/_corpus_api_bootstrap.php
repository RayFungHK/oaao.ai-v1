<?php

declare(strict_types=1);

/**
 * Corpus API bootstrap — PHP is thin only (auth, ACL, CRUD, enqueue, poll).
 * Heavy work: python/oaao_orchestrator (/v1/corpus/*). Do not add extract/LLM/render here.
 */

/**
 * @return array{
 *   auth: object,
 *   db: \Razy\Database,
 *   pdo: \PDO,
 *   user: object,
 *   uid: int,
 *   tenant_id: int,
 * }|null
 */
function oaao_corpus_require_pg(\Razy\Controller $controller): ?array
{
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $controller->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return null;
    }

    $auth->restrict(true);
    $user = $auth->getUser();
    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return null;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return null;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Corpus Studio requires PostgreSQL']);

        return null;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_corpus_schema.php';
    oaao_auth_ensure_corpus_schema($pdo);

    $core = $controller->api('core');
    $tenantId = $core ? $core->bootstrapTenantContext($pdo) : 1;

    return [
        'auth'      => $auth,
        'db'        => $db,
        'pdo'       => $pdo,
        'user'      => $user,
        'uid'       => $uid,
        'tenant_id' => max(1, $tenantId),
        'core'      => $core,
    ];
}

/**
 * @return int|null|false null = personal scope; int = team workspace; false = 403 already sent
 */
function oaao_corpus_resolve_workspace_scope(\Razy\Controller $controller, array $ctx, ?int $workspaceId): int|null|false
{
    if ($workspaceId === null || $workspaceId < 1) {
        return null;
    }

    $core = $ctx['core'] ?? $controller->api('core');
    if ($core && ! $core->userHasWorkspaceAccess($ctx['db'], $ctx['uid'], $workspaceId)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden workspace scope']);

        return false;
    }

    return $workspaceId;
}

/**
 * @param array<string, mixed> $input
 */
function oaao_corpus_workspace_from_request(array $input): ?int
{
    $raw = $_GET['workspace_id'] ?? $input['workspace_id'] ?? null;
    if ($raw === null || $raw === '') {
        return null;
    }
    $n = (int) $raw;

    return $n > 0 ? $n : null;
}

function oaao_corpus_orchestrator_unreachable_message(): string
{
    try {
        $base = \oaaoai\chat\ChatOrchestratorApi::internalBase();
    } catch (\Throwable) {
        return 'Orchestrator unreachable — set OAAO_ORCHESTRATOR_INTERNAL_URL and OAAO_ORCH_SHARED_SECRET, then start the orchestrator service (e.g. docker compose up -d orchestrator).';
    }

    if ($base === '') {
        return 'Orchestrator unreachable — OAAO_ORCHESTRATOR_INTERNAL_URL is empty.';
    }

    return 'Orchestrator unreachable at ' . $base . ' — confirm the orchestrator container is running and reachable from web (docker compose up -d orchestrator).';
}
