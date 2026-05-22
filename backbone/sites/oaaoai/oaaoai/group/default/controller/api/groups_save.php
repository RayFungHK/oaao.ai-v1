<?php

declare(strict_types=1);

use oaaoai\group\PermissionGroup;

/**
 * POST /group/api/groups_save — body JSON { id?, name, description?, disabled?, features?, limits? }
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
    $name = trim((string) ($body['name'] ?? ''));
    if ($name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Name required']);

        return;
    }
    if (strlen($name) > 120) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Name too long']);

        return;
    }

    $description = trim((string) ($body['description'] ?? ''));
    $disabled = ! empty($body['disabled']) && ($body['disabled'] === true || $body['disabled'] === 1 || $body['disabled'] === '1');
    $featuresRaw = isset($body['features']) && \is_array($body['features']) ? $body['features'] : [];
    $limitsRaw = isset($body['limits']) && \is_array($body['limits']) ? $body['limits'] : [];
    $doc = PermissionGroup::mergeDocuments(['features' => $featuresRaw], $limitsRaw);
    $permJson = PermissionGroup::encodePermissions($doc['features']);
    $limitsJson = PermissionGroup::encodeLimits($doc['limits']);
    $now = date('Y-m-d H:i:s');

    if ($id > 0) {
        $existsWhere = 'id=?';
        $existsParams = ['id' => $id];
        if ($tid > 0) {
            $existsWhere .= ',tenant_id=:tid';
            $existsParams['tid'] = $tid;
        }
        $exists = $db->prepare()
            ->select('id')
            ->from('group')
            ->where($existsWhere)
            ->assign($existsParams)
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($exists)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Group not found']);

            return;
        }
        $db->update('group', ['name', 'description', 'permissions_json', 'limits_json', 'disabled', 'updated_at'])
            ->where('id=?')
            ->assign([
                'name'              => $name,
                'description'       => $description !== '' ? $description : null,
                'permissions_json'  => $permJson,
                'limits_json'       => $limitsJson,
                'disabled'          => $disabled ? 1 : 0,
                'updated_at'        => $now,
                'id'                => $id,
            ])
            ->query();
        echo json_encode(['success' => true, 'data' => ['id' => $id]], JSON_UNESCAPED_UNICODE);

        return;
    }

    $db->insert('group', ['name', 'description', 'permissions_json', 'limits_json', 'disabled', 'tenant_id', 'created_at'])
        ->assign([
            'name'             => $name,
            'description'      => $description !== '' ? $description : null,
            'permissions_json' => $permJson,
            'limits_json'      => $limitsJson,
            'disabled'         => $disabled ? 1 : 0,
            'tenant_id'        => $tid > 0 ? $tid : null,
            'created_at'       => $now,
        ])
        ->query();

    $newId = (int) $db->getDBAdapter()->lastInsertId();
    echo json_encode(['success' => true, 'data' => ['id' => $newId]], JSON_UNESCAPED_UNICODE);
};
