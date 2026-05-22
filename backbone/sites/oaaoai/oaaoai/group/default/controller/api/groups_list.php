<?php

declare(strict_types=1);

use oaaoai\group\PermissionGroup;

/**
 * GET /group/api/groups_list
 */
return function (): void {
    $db = $this->oaao_group_require_admin();
    if (! $db instanceof \Razy\Database) {
        return;
    }

    try {
        require_once dirname(__DIR__, 4) . '/core/default/library/TenantContext.php';
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            \Oaaoai\Core\TenantContext::bootstrap($pdo);
        }
        $tid = \Oaaoai\Core\TenantContext::id();

        $page = max(1, (int) ($_GET['page'] ?? 1));
        $pageSize = max(1, min(100, (int) ($_GET['page_size'] ?? 10)));
        $offset = ($page - 1) * $pageSize;

        $countQuery = $db->prepare()->select('COUNT(*) AS c')->from('group');
        if ($tid > 0) {
            $countQuery = $countQuery->where('tenant_id=:tid')->assign(['tid' => $tid]);
        }
        $countRow = $countQuery->query()->fetch();
        $total = 0;
        if (\is_array($countRow)) {
            $total = (int) ($countRow['c'] ?? $countRow['C'] ?? 0);
        }

        $q = $db->prepare()
            ->select('id, name, description, permissions_json, limits_json, disabled, created_at, updated_at')
            ->from('group');
        if ($tid > 0) {
            $q = $q->where('tenant_id=:tid')->assign(['tid' => $tid]);
        }
        $rows = $q->order('<name')->limit($pageSize, $offset)->query()->fetchAll();

        /** @var list<array<string, mixed>> $out */
        $out = [];
        if (\is_array($rows)) {
            foreach ($rows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $gid = (int) ($row['id'] ?? 0);
                if ($gid < 1) {
                    continue;
                }
                $memberCount = $db->prepare()
                    ->select('COUNT(*) AS c')
                    ->from('group_member')
                    ->where('group_id=?')
                    ->assign(['group_id' => $gid])
                    ->query()
                    ->fetch();
                $cnt = 0;
                if (\is_array($memberCount)) {
                    $cnt = (int) ($memberCount['c'] ?? $memberCount['C'] ?? 0);
                }
                $out[] = [
                    'id'           => $gid,
                    'name'         => (string) ($row['name'] ?? ''),
                    'description'  => (string) ($row['description'] ?? ''),
                    'disabled'     => (int) ($row['disabled'] ?? 0) !== 0,
                    'features'     => PermissionGroup::parsePermissions(isset($row['permissions_json']) ? (string) $row['permissions_json'] : null),
                    'limits'       => PermissionGroup::parseLimits(isset($row['limits_json']) ? (string) $row['limits_json'] : null),
                    'member_count' => $cnt,
                    'created_at'   => (string) ($row['created_at'] ?? ''),
                    'updated_at'   => (string) ($row['updated_at'] ?? ''),
                ];
            }
        }

        $totalPages = $pageSize > 0 ? (int) max(1, (int) ceil($total / $pageSize)) : 1;

        echo json_encode([
            'success' => true,
            'data'    => [
                'groups'     => $out,
                'pagination' => [
                    'page'        => $page,
                    'page_size'   => $pageSize,
                    'total'       => $total,
                    'total_pages' => $totalPages,
                ],
            ],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load permission groups']);
    }
};
