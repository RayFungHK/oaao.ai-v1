<?php

declare(strict_types=1);

/**
 * GET /user/api/users_list
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

    try {
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $auth->ensurePermissionGroupSchema($pdo);
        }

        $core = $this->api('core');
        $tid = 0;
        if ($pdo instanceof \PDO && $core) {
            $tid = $core->bootstrapTenantContext($pdo);
        }

        $page = max(1, (int) ($_GET['page'] ?? 1));
        $pageSize = max(1, min(100, (int) ($_GET['page_size'] ?? 10)));
        $offset = ($page - 1) * $pageSize;

        $countQuery = $db->prepare()->select('COUNT(*) AS c')->from('user');
        if ($tid > 0) {
            $countQuery = $countQuery->where('tenant_id=:tid')->assign(['tid' => $tid]);
        }
        $countRow = $countQuery->query()->fetch();
        $total = 0;
        if (\is_array($countRow)) {
            $total = (int) ($countRow['c'] ?? $countRow['C'] ?? 0);
        }

        $userQuery = $db->prepare()
            ->select('user_id, login_name, display_name, email, role, disabled, permission_group_id, last_login, created_at')
            ->from('user');
        if ($tid > 0) {
            $userQuery = $userQuery->where('tenant_id=:tid')->assign(['tid' => $tid]);
        }
        $rows = $userQuery->order('<login_name')->limit($pageSize, $offset)->query()->fetchAll();

        /** @var array<int, string> $groupNames */
        $groupNames = [];
        $groupQuery = $db->prepare()->select('id, name')->from('group');
        if ($tid > 0) {
            $groupQuery = $groupQuery->where('tenant_id=:tid')->assign(['tid' => $tid]);
        }
        $gRows = $groupQuery->order('<name')->query()->fetchAll();
        if (\is_array($gRows)) {
            foreach ($gRows as $gr) {
                if (! \is_array($gr)) {
                    continue;
                }
                $gid = (int) ($gr['id'] ?? 0);
                if ($gid > 0) {
                    $groupNames[$gid] = (string) ($gr['name'] ?? '');
                }
            }
        }

        /** @var list<array<string, mixed>> $out */
        $out = [];
        if (\is_array($rows)) {
            foreach ($rows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $uid = (int) ($row['user_id'] ?? 0);
                if ($uid < 1) {
                    continue;
                }
                $gid = isset($row['permission_group_id']) ? (int) $row['permission_group_id'] : 0;
                $out[] = [
                    'user_id'               => $uid,
                    'login_name'            => (string) ($row['login_name'] ?? ''),
                    'display_name'          => (string) ($row['display_name'] ?? ''),
                    'email'                 => (string) ($row['email'] ?? ''),
                    'role'                  => (string) ($row['role'] ?? 'user'),
                    'disabled'              => (int) ($row['disabled'] ?? 0) !== 0,
                    'permission_group_id'   => $gid > 0 ? $gid : null,
                    'permission_group_name' => ($gid > 0 && isset($groupNames[$gid])) ? $groupNames[$gid] : null,
                    'last_login'            => (string) ($row['last_login'] ?? ''),
                    'created_at'            => (string) ($row['created_at'] ?? ''),
                ];
            }
        }

        $groups = [];
        foreach ($groupNames as $id => $nm) {
            $groups[] = ['id' => $id, 'name' => $nm];
        }
        usort($groups, static fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));

        $totalPages = $pageSize > 0 ? (int) max(1, (int) ceil($total / $pageSize)) : 1;

        echo json_encode([
            'success' => true,
            'data'    => [
                'users'      => $out,
                'groups'     => $groups,
                'pagination' => [
                    'page'        => $page,
                    'page_size'   => $pageSize,
                    'total'       => $total,
                    'total_pages' => $totalPages,
                ],
            ],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load users']);
    }
};
