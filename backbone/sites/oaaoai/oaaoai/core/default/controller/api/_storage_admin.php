<?php

declare(strict_types=1);

use Oaaoai\Core\AuthSchemaBridge;
use Oaaoai\Core\StorageSchemaEnsure;

/**
 * Admin + tenant context for storage settings APIs.
 *
 * @return array{pdo: \PDO, tenant_id: int}|null
 */
function oaao_core_storage_require_admin(object $controller): ?array
{
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $controller->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return null;
    }

    $auth->restrict(true);
    if (! $auth->requireAdmin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Administrator required']);

        return null;
    }

    $db = $auth->getDB();
    if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return null;
    }

    if (method_exists($auth, 'ensurePgCoreTables')) {
        $auth->ensurePgCoreTables($db);
    }

    $pdo = $db->getDBAdapter();
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'PostgreSQL required for storage settings']);

        return null;
    }

    StorageSchemaEnsure::ensure($pdo);

    $core = $controller->api('core');
    $tenantId = $core ? (int) $core->bootstrapTenantContext($pdo) : 0;
    if ($tenantId < 1) {
        $user = method_exists($auth, 'getUser') ? $auth->getUser() : null;
        $uid = \is_object($user) ? (int) ($user->user_id ?? 0) : 0;
        if ($uid > 0) {
            $st = $pdo->prepare('SELECT tenant_id FROM oaao_user WHERE user_id = ? LIMIT 1');
            $st->execute([$uid]);
            $tid = (int) ($st->fetchColumn() ?: 0);
            if ($tid > 0) {
                $tenantId = $tid;
            }
        }
    }
    if ($tenantId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context unavailable']);

        return null;
    }

    return ['pdo' => $pdo, 'tenant_id' => $tenantId];
}
