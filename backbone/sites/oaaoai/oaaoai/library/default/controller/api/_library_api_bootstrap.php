<?php

declare(strict_types=1);

/**
 * Library API — thin PHP only.
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
function oaao_library_require_pg(\Razy\Controller $controller): ?array
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
        echo json_encode(['success' => false, 'message' => 'Library requires PostgreSQL']);

        return null;
    }

    $auth->ensureLibrarySchema($pdo);

    $tenantId = (int) ($user->tenant_id ?? 0);

    return [
        'auth'      => $auth,
        'db'        => $db,
        'pdo'       => $pdo,
        'user'      => $user,
        'uid'       => $uid,
        'tenant_id' => $tenantId,
    ];
}
