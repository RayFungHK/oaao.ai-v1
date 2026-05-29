<?php

/**
 * POST /auth/register — Create a new user account.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $db = $this->getDB();
    if (!$db) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'Database not available']);
        return;
    }

    try {
        require_once __DIR__ . '/_ensure_pg_core_tables.php';
        if (oaao_auth_database_is_pgsql($db)) {
            oaao_auth_ensure_pg_core_tables($db);
        }
    } catch (\Throwable $e) {
        error_log('oaaoai/auth register ensure PG: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        http_response_code(500);
        echo json_encode([
            'result'  => false,
            'message' => 'Database initialization failed — check Postgres permissions and logs.',
        ]);
        return;
    }

    $allowPublic = getenv('OAAO_ALLOW_PUBLIC_REGISTER');
    if ($allowPublic === false || trim((string) $allowPublic) === '' || trim((string) $allowPublic) === '0') {
        http_response_code(403);
        echo json_encode([
            'result'  => false,
            'message' => 'Public registration is disabled. Use an invitation link from your administrator.',
            'code'    => 'invite_required',
        ]);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $email       = trim($input['email'] ?? '');
    $password    = $input['password'] ?? '';
    $displayName = trim($input['display_name'] ?? '');

    if (empty($email) || empty($password)) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Email and password required']);
        return;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Invalid email address']);
        return;
    }

    $email = strtolower($email);

    if (strlen($password) < 6) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Password must be at least 6 characters']);
        return;
    }

    $User = $this->loadModel('User');

    $tenantId = null;
    $pdo = $db->getDBAdapter();
    if ($pdo instanceof \PDO && oaao_auth_database_is_pgsql($db)) {
        require_once dirname(__DIR__, 4) . '/core/default/library/TenantContext.php';
        \Oaaoai\Core\TenantContext::require($pdo);
        if (\Oaaoai\Core\TenantContext::signupMode() !== 'public') {
            http_response_code(403);
            echo json_encode(['result' => false, 'message' => 'Registration is disabled for this tenant']);

            return;
        }
        $tenantId = \Oaaoai\Core\TenantContext::id();
    }

    if ($User::findByEmail($db, $email, $tenantId)) {
        http_response_code(409);
        echo json_encode(['result' => false, 'message' => 'Email already registered']);
        return;
    }

    // Derive login_name from email, ensure unique
    $loginName = explode('@', $email)[0];
    $base = $loginName;
    $i = 1;
    while ($User::findByLoginName($db, $loginName, $tenantId)) {
        $loginName = $base . $i;
        $i++;
    }

    $displayName = $displayName ?: $loginName;

    // Insert user via Razy Statement builder
    $db->insert('user', ['login_name', 'password', 'display_name', 'email', 'role', 'disabled', 'tenant_id', 'created_at', 'updated_at'])
        ->assign([
            'login_name'   => $loginName,
            'password'     => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
            'display_name' => $displayName,
            'email'        => $email,
            'role'         => 'user',
            'disabled'     => 0,
            'tenant_id'    => ($tenantId !== null && $tenantId > 0) ? $tenantId : null,
            'created_at'   => date('Y-m-d H:i:s'),
            'updated_at'   => date('Y-m-d H:i:s'),
        ])
        ->query();
    $userId = $db->lastID();

    // Load the user from ORM so we can generate a session
    $user = $User::findByLoginName($db, $loginName, $tenantId);
    if (!$user) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'Unexpected error']);
        return;
    }

    $token = $user->generateSession(86400, $db);

    setcookie($this->getSessionCookieName(), $token, [
        'expires'  => time() + 86400,
        'path'     => $this->getSessionCookiePath(),
        'httponly'  => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);

    echo json_encode([
        'result'  => true,
        'message' => 'Account created',
        'data'    => [
            'user_id'      => (int) $userId,
            'email'        => $email,
            'display_name' => $displayName,
            'role'         => 'user',
            'session_key'  => $token,
        ],
    ]);
};
