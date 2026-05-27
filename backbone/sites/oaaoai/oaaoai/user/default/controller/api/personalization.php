<?php

declare(strict_types=1);

use oaaoai\user\UserPersonalization;

/**
 * GET /user/api/personalization — profile + knowledge + locale context for Preferences → Personalization.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    $user = $auth ? $auth->getUser() : null;

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

    require_once dirname(__DIR__, 2) . '/library/UserPersonalization.php';
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_credit_schema.php';
    oaao_auth_ensure_credit_schema($pdo);

    $uid = (int) ($user->user_id ?? 0);
    $personalization = UserPersonalization::loadForUser($pdo, $uid);

    echo json_encode([
        'success' => true,
        'data'    => [
            'personalization' => $personalization,
            'timezone_options' => UserPersonalization::allowedTimezones(),
            'display_name'     => (string) ($user->display_name ?? ''),
        ],
    ]);
};
