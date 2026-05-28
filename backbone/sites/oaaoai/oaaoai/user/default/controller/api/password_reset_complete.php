<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationSupport;

/**
 * POST /user/api/password_reset_complete — body { token, password }
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_pg_public($this);
    if ($ctx === null) {
        return;
    }

    $auth = $ctx['auth'];
    $db = $ctx['db'];
    $pdo = $ctx['pdo'];

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $plain = trim((string) ($body['token'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if ($plain === '' || ! preg_match('/^[a-f0-9]{64}$/i', $plain)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid token']);

        return;
    }

    if (strlen($password) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password must be at least 6 characters']);

        return;
    }

    $hash = UserInvitationSupport::hashToken($plain);
    $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');

    $row = $db->prepare()
        ->select('reset_id, user_id')
        ->from('password_reset')
        ->where('token_hash=:th, status=:st, expires_at>:ts')
        ->assign(['th' => $hash, 'st' => 'pending', 'ts' => $nowIso])
        ->limit(1)
        ->query()
        ->fetch();

    if (! \is_array($row)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Reset link expired or invalid']);

        return;
    }

    $resetId = (int) ($row['reset_id'] ?? 0);
    $userId = (int) ($row['user_id'] ?? 0);
    if ($userId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid reset']);

        return;
    }

    $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    if (! \is_string($passwordHash)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not set password']);

        return;
    }

    $User = $auth->loadModel('User');
    $User::savePasswordHash($db, $userId, $passwordHash);

    $pdo->prepare(
        'UPDATE oaao_password_reset SET status = ?, used_at = CURRENT_TIMESTAMP WHERE reset_id = ?',
    )->execute(['used', $resetId]);

    echo json_encode(['success' => true, 'message' => 'Password updated']);
};
