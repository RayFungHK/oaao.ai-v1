<?php

declare(strict_types=1);

/**
 * POST /user/api/password_change — body JSON { current_password, new_password }
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

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $current = (string) ($body['current_password'] ?? '');
    $newPass = (string) ($body['new_password'] ?? '');

    if ($current === '' || $newPass === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'current_password and new_password required']);

        return;
    }

    if (strlen($newPass) < 8) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password must be at least 8 characters']);

        return;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $User = $this->loadModel('User');
    $hash = $User::fetchPasswordHash($db, $uid);
    if ($hash === '' || ! password_verify($current, $hash)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Current password is incorrect']);

        return;
    }

    $newHash = password_hash($newPass, PASSWORD_BCRYPT, ['cost' => 12]);
    $User::savePasswordHash($db, $uid, $newHash);

    echo json_encode(['success' => true]);
};
