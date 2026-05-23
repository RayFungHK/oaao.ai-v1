<?php

declare(strict_types=1);

use Oaaoai\Core\UsageEventRepository;

require_once dirname(__DIR__, 4) . '/core/default/library/UsageEventRepository.php';

/**
 * GET /endpoints/api/usage_by_purpose — tenant admin usage grouped by purpose_key.
 *
 * Query: {@code days} (1–365, default 30), optional {@code user_id} for a single member.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        echo json_encode(['success' => true, 'rows' => [], 'days' => 30]);

        return;
    }

    $core = $this->api('core');
    $tenantId = $core ? $core->bootstrapTenantContext($pdo) : 0;
    if ($tenantId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Tenant context required']);

        return;
    }

    $days = isset($_GET['days']) ? (int) $_GET['days'] : 30;
    $userId = isset($_GET['user_id']) ? (int) $_GET['user_id'] : 0;

    try {
        $rows = UsageEventRepository::aggregateByPurpose(
            $pdo,
            $tenantId,
            $userId > 0 ? $userId : null,
            $days,
        );
        echo json_encode(
            [
                'success' => true,
                'rows'    => $rows,
                'days'    => max(1, min(365, $days)),
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load usage by purpose']);
    }
};
