<?php

declare(strict_types=1);

use Oaaoai\Core\TenantRepository;

/**
 * GET /platform/api/tenants_list
 */
return function (): void {
    $db = $this->oaao_platform_require_pg();
    if ($db === null) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => ['tenants' => TenantRepository::listTenants($pdo)],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
