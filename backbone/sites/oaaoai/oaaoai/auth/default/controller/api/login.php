<?php

/**
 * POST …/login — login_name or email + password.
 *
 * User via ORM; bcrypt hash via {@see User::fetchPasswordHash()} (`password` is `$hidden`).
 */
return function (): void {
    try {
        header('Content-Type: application/json; charset=UTF-8');

        $db = $this->getDB();
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(500);
            echo json_encode(['result' => false, 'message' => 'Database not available']);

            return;
        }

        if ($this->databaseIsPgsql()) {
            $this->ensurePgCoreTables($db);
        }

        $tenantId = null;
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO && oaao_auth_database_is_pgsql($db)) {
            require_once dirname(__DIR__, 4) . '/core/default/library/TenantContext.php';
            \Oaaoai\Core\TenantContext::require($pdo);
            if (! \Oaaoai\Core\TenantContext::isActive()) {
                http_response_code(403);
                echo json_encode(['result' => false, 'message' => 'Tenant is suspended']);

                return;
            }
            $tenantId = \Oaaoai\Core\TenantContext::id();
        }

        $input = json_decode(file_get_contents('php://input'), true) ?: [];
        $loginName = trim((string) ($input['login_name'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        $remember = ! empty($input['remember_me']);

        if ($loginName === '' || $password === '') {
            http_response_code(400);
            echo json_encode(['result' => false, 'message' => 'Login name and password required']);

            return;
        }

        $User = $this->loadModel('User');
        $user = $User::findForLogin($db, $loginName, $tenantId);

        if (! $user) {
            http_response_code(401);
            echo json_encode(['result' => false, 'message' => 'Invalid credentials']);

            return;
        }

        $hash = $User::fetchPasswordHash($db, (int) $user->user_id);

        if ($hash === '' || ! password_verify($password, $hash)) {
            http_response_code(401);
            echo json_encode(['result' => false, 'message' => 'Invalid credentials']);

            return;
        }

        if ($tenantId > 0) {
            $userTid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
            if ($userTid < 1) {
                $User::bindTenantId($db, (int) $user->user_id, $tenantId);
                $user->tenant_id = $tenantId;
            }
        }

        if ((int) ($user->disabled ?? 0) !== 0) {
            http_response_code(403);
            echo json_encode(['result' => false, 'message' => 'Account disabled']);

            return;
        }

        if ($pdo instanceof \PDO && \Oaaoai\Core\TenantContext::isPlatform() && ! $User::isPlatformOperator($user)) {
            http_response_code(401);
            echo json_encode(['result' => false, 'message' => 'Platform administrator account required']);

            return;
        }

        if (password_needs_rehash($hash, PASSWORD_BCRYPT, ['cost' => 12])) {
            $User::savePasswordHash($db, (int) $user->user_id, password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]));
        }

        $lifetime = $remember ? 30 * 86400 : 86400;
        $token = $user->generateSession($lifetime, $db);

        setcookie($this->getSessionCookieName(), $token, [
            'expires'  => time() + $lifetime,
            'path'     => $this->getSessionCookiePath(),
            'httponly'  => true,
            'samesite' => 'Lax',
            'secure'   => ! empty($_SERVER['HTTPS']),
        ]);

        echo json_encode([
            'result'  => true,
            'message' => 'Logged in',
            'data'    => [
                'user_id'      => (int) $user->user_id,
                'email'        => $user->email ?? '',
                'display_name' => $user->display_name,
                'role'         => $user->role,
                'session_key'  => $token,
            ],
        ]);
    } catch (\Throwable $e) {
        error_log('oaaoai/auth login: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (! headers_sent()) {
            header('Content-Type: application/json; charset=UTF-8');
        }
        http_response_code(500);
        echo json_encode([
            'result'  => false,
            'message' => 'Sign-in failed due to a server error. Check server logs.',
        ]);
    }
};
