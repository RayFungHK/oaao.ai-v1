<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationSupport;

/**
 * POST /user/api/register_complete — public; body { token, display_name, password }
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
    $displayName = trim((string) ($body['display_name'] ?? ''));
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
        ->select('invitation_id, email, role, permission_group_id, tenant_id')
        ->from('user_invitation')
        ->where('token_hash=:th, status=:st, expires_at>:ts')
        ->assign(['th' => $hash, 'st' => 'pending', 'ts' => $nowIso])
        ->limit(1)
        ->query()
        ->fetch();

    if (! \is_array($row)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invitation expired or invalid']);

        return;
    }

    $invId = (int) ($row['invitation_id'] ?? 0);
    $email = UserInvitationSupport::normalizeEmail((string) ($row['email'] ?? ''));
    $tenantId = (int) ($row['tenant_id'] ?? 0);
    $role = (string) ($row['role'] ?? 'user');
    if ($role !== 'admin') {
        $role = 'user';
    }
    $groupId = isset($row['permission_group_id']) ? (int) $row['permission_group_id'] : 0;

    $loginName = explode('@', $email)[0];
    $base = $loginName;
    $i = 1;
    $User = $auth->loadModel('User');
    while ($User::findByLoginName($db, $loginName, $tenantId > 0 ? $tenantId : null)) {
        $loginName = $base . $i;
        $i++;
    }

    if ($displayName === '') {
        $displayName = $loginName;
    }

    $now = date('Y-m-d H:i:s');
    $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    try {
        $pdo->beginTransaction();

        $db->insert('user', ['login_name', 'password', 'display_name', 'email', 'role', 'disabled', 'tenant_id', 'permission_group_id', 'created_at', 'updated_at'])
            ->assign([
                'login_name'          => $loginName,
                'password'            => $passwordHash,
                'display_name'        => $displayName,
                'email'               => $email,
                'role'                => $role,
                'disabled'            => 0,
                'tenant_id'           => $tenantId > 0 ? $tenantId : null,
                'permission_group_id' => $groupId > 0 ? $groupId : null,
                'created_at'          => $now,
                'updated_at'          => $now,
            ])
            ->query();

        $userId = (int) $db->lastID();

        $pdo->prepare(
            'UPDATE oaao_user_invitation SET status = ?, accepted_at = CURRENT_TIMESTAMP, accepted_user_id = ? WHERE invitation_id = ?',
        )->execute(['accepted', $userId, $invId]);

        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('oaaoai/user register_complete: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Registration failed']);

        return;
    }

    $user = $User::findByLoginName($db, $loginName, $tenantId > 0 ? $tenantId : null);
    if (! $user) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Unexpected error']);

        return;
    }

    $token = $user->generateSession(86400, $db);
    setcookie($auth->getSessionCookieName(), $token, [
        'expires'  => time() + 86400,
        'path'     => $auth->getSessionCookiePath(),
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => ! empty($_SERVER['HTTPS']),
    ]);

    echo json_encode([
        'success' => true,
        'message' => 'Account created',
        'data'    => [
            'user_id'      => $userId,
            'email'        => $email,
            'display_name' => $displayName,
            'login_name'   => $loginName,
        ],
    ], JSON_UNESCAPED_UNICODE);
};
