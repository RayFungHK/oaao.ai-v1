<?php

declare(strict_types=1);

/**
 * POST /group/api/groups_delete — body JSON { id }
 */
return function (): void {
    $db = $this->oaao_group_require_admin();
    if (! $db instanceof \Razy\Database) {
        return;
    }

    require_once dirname(__DIR__, 4) . '/core/default/library/TenantContext.php';
    $pdo = $db->getDBAdapter();
    $tid = 0;
    if ($pdo instanceof \PDO) {
        \Oaaoai\Core\TenantContext::bootstrap($pdo);
        $tid = \Oaaoai\Core\TenantContext::id();
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $id = isset($body['id']) ? (int) $body['id'] : 0;
    if ($id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'id required']);

        return;
    }

    if ($tid > 0) {
        $exists = $db->prepare()
            ->select('id')
            ->from('group')
            ->where('id=:id,tenant_id=:tid')
            ->assign(['id' => $id, 'tid' => $tid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($exists)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Group not found']);

            return;
        }
    }

    $db->delete('group_member', ['group_id' => $id])->query();

    $userWhere = 'permission_group_id=:gid';
    $userParams = [
        'permission_group_id' => null,
        'updated_at'          => date('Y-m-d H:i:s'),
        'gid'                 => $id,
    ];
    if ($tid > 0) {
        $userWhere .= ',tenant_id=:tid';
        $userParams['tid'] = $tid;
    }
    $db->update('user', ['permission_group_id', 'updated_at'])
        ->where($userWhere)
        ->assign($userParams)
        ->query();

    if ($tid > 0) {
        $db->delete('group', ['id' => $id, 'tenant_id' => $tid])->query();
    } else {
        $db->delete('group', ['id' => $id])->query();
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
