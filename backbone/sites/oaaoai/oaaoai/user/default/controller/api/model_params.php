<?php

declare(strict_types=1);

use oaaoai\user\UserModelParams;

/**
 * GET /user/api/model_params — UX-1 read saved overrides.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    $auth->restrict(true);
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 2) . '/library/UserModelParams.php';

    $uid = (int) ($user->user_id ?? 0);
    $params = UserModelParams::loadForUser($pdo, $uid);

    echo json_encode([
        'success' => true,
        'data'    => [
            'model_params' => $params,
            'active'       => UserModelParams::activeOverrides($params),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
