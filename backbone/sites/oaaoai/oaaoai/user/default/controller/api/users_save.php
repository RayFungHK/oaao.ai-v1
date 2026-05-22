<?php

declare(strict_types=1);

/**
 * POST /user/api/users_save — body JSON { user_id?, login_name, display_name?, email?, password?, role?, disabled?, permission_group_id? }
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
    if (! $auth->requireAdmin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Administrator required']);

        return;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $pdo = $db->getDBAdapter();
    if ($pdo instanceof \PDO) {
        $auth->ensurePermissionGroupSchema($pdo);
    }

    $core = $this->api('core');
    $tid = 0;
    if ($pdo instanceof \PDO && $core) {
        $tid = $core->bootstrapTenantContext($pdo);
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $uid = isset($body['user_id']) ? (int) $body['user_id'] : 0;
    $loginName = trim((string) ($body['login_name'] ?? ''));
    if ($loginName === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'login_name required']);

        return;
    }

    $displayName = trim((string) ($body['display_name'] ?? $loginName));
    $emailRaw = trim((string) ($body['email'] ?? ''));
    $email = $emailRaw !== '' ? strtolower($emailRaw) : null;
    $role = trim((string) ($body['role'] ?? 'user'));
    if ($role !== 'admin') {
        $role = 'user';
    }
    $disabled = ! empty($body['disabled']) && ($body['disabled'] === true || $body['disabled'] === 1 || $body['disabled'] === '1');
    $groupId = isset($body['permission_group_id']) ? (int) $body['permission_group_id'] : 0;
    if ($groupId < 1) {
        $groupId = 0;
    }
    $password = (string) ($body['password'] ?? '');
    $now = date('Y-m-d H:i:s');

    if ($groupId > 0) {
        $gWhere = 'id=?';
        $gParams = ['id' => $groupId];
        if ($tid > 0) {
            $gWhere .= ',tenant_id=:tid';
            $gParams['tid'] = $tid;
        }
        $gOk = $db->prepare()
            ->select('id')
            ->from('group')
            ->where($gWhere)
            ->assign($gParams)
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($gOk)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid permission group']);

            return;
        }
    }

    if ($uid > 0) {
        $existsWhere = 'user_id=?';
        $existsParams = ['user_id' => $uid];
        if ($tid > 0) {
            $existsWhere .= ',tenant_id=:tid';
            $existsParams['tid'] = $tid;
        }
        $exists = $db->prepare()
            ->select('user_id')
            ->from('user')
            ->where($existsWhere)
            ->assign($existsParams)
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($exists)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'User not found']);

            return;
        }

        $dupWhere = 'login_name=?,user_id!=?';
        $dupParams = ['login_name' => $loginName, 'user_id' => $uid];
        if ($tid > 0) {
            $dupWhere .= ',tenant_id=:tid';
            $dupParams['tid'] = $tid;
        }
        $dup = $db->prepare()
            ->select('user_id')
            ->from('user')
            ->where($dupWhere)
            ->assign($dupParams)
            ->limit(1)
            ->query()
            ->fetch();
        if (\is_array($dup)) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'login_name already in use']);

            return;
        }

        $db->update('user', ['login_name', 'display_name', 'email', 'role', 'disabled', 'permission_group_id', 'updated_at'])
            ->where('user_id=?')
            ->assign([
                'login_name'          => $loginName,
                'display_name'        => $displayName,
                'email'               => $email,
                'role'                => $role,
                'disabled'            => $disabled ? 1 : 0,
                'permission_group_id' => $groupId > 0 ? $groupId : null,
                'updated_at'          => $now,
                'user_id'             => $uid,
            ])
            ->query();

        if ($password !== '') {
            $hash = password_hash($password, PASSWORD_BCRYPT);
            if (\is_string($hash)) {
                $userModel = $auth->loadModel('User');
                if ($userModel) {
                    $userModel::savePasswordHash($db, $uid, $hash);
                }
            }
        }
    } else {
        $dupWhere = 'login_name=?';
        $dupParams = ['login_name' => $loginName];
        if ($tid > 0) {
            $dupWhere .= ',tenant_id=:tid';
            $dupParams['tid'] = $tid;
        }
        $dup = $db->prepare()
            ->select('user_id')
            ->from('user')
            ->where($dupWhere)
            ->assign($dupParams)
            ->limit(1)
            ->query()
            ->fetch();
        if (\is_array($dup)) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'login_name already in use']);

            return;
        }
        if ($password === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'password required for new user']);

            return;
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        if (! \is_string($hash)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not hash password']);

            return;
        }

        $db->insert('user', [
            'login_name', 'password', 'display_name', 'email', 'role', 'disabled', 'permission_group_id', 'tenant_id', 'created_at',
        ])
            ->assign([
                'login_name'          => $loginName,
                'password'            => $hash,
                'display_name'        => $displayName,
                'email'               => $email,
                'role'                => $role,
                'disabled'            => $disabled ? 1 : 0,
                'permission_group_id' => $groupId > 0 ? $groupId : null,
                'tenant_id'           => $tid > 0 ? $tid : null,
                'created_at'          => $now,
            ])
            ->query();
        $uid = (int) $pdo->lastInsertId();
    }

    $db->delete('group_member', ['user_id' => $uid])->query();
    if ($groupId > 0) {
        $db->insert('group_member', ['group_id', 'user_id', 'created_at'])
            ->assign([
                'group_id'   => $groupId,
                'user_id'    => $uid,
                'created_at' => $now,
            ])
            ->query();
    }

    echo json_encode(['success' => true, 'data' => ['user_id' => $uid]], JSON_UNESCAPED_UNICODE);
};
