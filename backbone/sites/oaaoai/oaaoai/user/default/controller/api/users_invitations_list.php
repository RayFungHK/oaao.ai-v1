<?php

declare(strict_types=1);

/**
 * GET /user/api/users_invitations_list — pending tenant invitations (admin).
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_admin_pg($this);
    if ($ctx === null) {
        return;
    }

    $db = $ctx['db'];
    $tid = $ctx['tenant_id'];

    $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    $invQuery = $db->prepare()
        ->select('invitation_id, email, role, status, expires_at, created_at, invited_by_user_id, permission_group_id')
        ->from('user_invitation')
        ->where('tenant_id=:tid, status=:st, expires_at>:ts')
        ->assign(['tid' => $tid, 'st' => 'pending', 'ts' => $nowIso])
        ->order('<created_at');
    $rows = $invQuery->query()->fetchAll();

    $items = [];
    if (\is_array($rows)) {
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $items[] = [
                'invitation_id'        => (int) ($row['invitation_id'] ?? 0),
                'email'                => (string) ($row['email'] ?? ''),
                'role'                 => (string) ($row['role'] ?? 'user'),
                'status'               => (string) ($row['status'] ?? ''),
                'expires_at'           => (string) ($row['expires_at'] ?? ''),
                'created_at'           => (string) ($row['created_at'] ?? ''),
                'invited_by_user_id'   => (int) ($row['invited_by_user_id'] ?? 0),
                'permission_group_id'  => isset($row['permission_group_id']) ? (int) $row['permission_group_id'] : null,
            ];
        }
    }

    echo json_encode(['success' => true, 'data' => ['invitations' => $items]], JSON_UNESCAPED_UNICODE);
};
