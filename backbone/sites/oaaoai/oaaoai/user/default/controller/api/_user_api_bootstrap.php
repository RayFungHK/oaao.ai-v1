<?php

declare(strict_types=1);

/**
 * @return array{auth: object, db: \Razy\Database, pdo: \PDO, user: object, uid: int, tenant_id: int}|null
 */
function oaao_user_require_admin_pg(\Razy\Controller $controller): ?array
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
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return null;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'User invitations require PostgreSQL']);

        return null;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_user_invitation_schema.php';
    oaao_auth_ensure_user_invitation_schema($pdo);

    $core = $controller->api('core');
    $tenantId = $core ? $core->bootstrapTenantContext($pdo) : 1;
    $user = $auth->getUser();
    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return null;
    }

    return [
        'auth'       => $auth,
        'db'         => $db,
        'pdo'        => $pdo,
        'user'       => $user,
        'uid'        => $uid,
        'tenant_id'  => max(1, $tenantId),
    ];
}

/**
 * @return array{auth: object, db: \Razy\Database, pdo: \PDO}|null
 */
function oaao_user_require_pg_public(\Razy\Controller $controller): ?array
{
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $controller->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

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
        echo json_encode(['success' => false, 'message' => 'Service requires PostgreSQL']);

        return null;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_user_invitation_schema.php';
    oaao_auth_ensure_user_invitation_schema($pdo);

    return ['auth' => $auth, 'db' => $db, 'pdo' => $pdo];
}
