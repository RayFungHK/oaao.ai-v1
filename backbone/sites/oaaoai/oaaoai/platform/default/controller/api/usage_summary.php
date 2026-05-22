<?php

declare(strict_types=1);

use Oaaoai\Core\TenantRepository;

/**
 * GET /platform/api/usage_summary — per-tenant user/vault/event counts.
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
        'data'    => TenantRepository::usageSummary($pdo),
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
