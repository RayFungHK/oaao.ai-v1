<?php

declare(strict_types=1);

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
function oaao_calendar_require_pg(\Razy\Controller $controller, bool $quiet = false): ?array
{
    if (! $quiet) {
        header('Content-Type: application/json; charset=UTF-8');
    }

    $auth = $controller->api('auth');
    if (! $auth) {
        if (! $quiet) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);
        }

        return null;
    }

    $auth->restrict(true);
    $user = $auth->getUser();
    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        if (! $quiet) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        }

        return null;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        if (! $quiet) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);
        }

        return null;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        if (! $quiet) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Calendar requires PostgreSQL']);
        }

        return null;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_calendar_schema.php';
    oaao_auth_ensure_calendar_schema($pdo);

    return [
        'auth'      => $auth,
        'db'        => $db,
        'pdo'       => $pdo,
        'user'      => $user,
        'uid'       => $uid,
        'tenant_id' => (int) ($user->tenant_id ?? 0),
    ];
}
