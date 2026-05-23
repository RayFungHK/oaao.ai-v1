<?php

declare(strict_types=1);

use Oaaoai\Core\UsageEventRepository;
use oaaoai\endpoints\CanonicalEndpointsRepository;

require_once dirname(__DIR__, 4) . '/core/default/library/UsageEventRepository.php';

/**
 * GET /endpoints/api/endpoints_usage_stats — avg tokens per endpoint (admin overload guard).
 *
 * Query: {@code days} (7–30, default 14) for daily avg chart buckets.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        echo json_encode(['success' => true, 'stats' => [], 'days' => 14]);

        return;
    }

    $core = $this->api('core');
    $tenantId = $core ? $core->bootstrapTenantContext($pdo) : 0;
    if ($tenantId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Tenant context required']);

        return;
    }

    $days = isset($_GET['days']) ? (int) $_GET['days'] : 14;

    try {
        $repo = new CanonicalEndpointsRepository($db, $core);
        $endpoints = $repo->listEndpoints();
        $stats = UsageEventRepository::endpointChatTokenStats($pdo, $tenantId, \is_array($endpoints) ? $endpoints : [], $days);
        echo json_encode(
            [
                'success' => true,
                'stats'   => $stats,
                'days'    => max(7, min(30, $days)),
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load endpoint usage stats']);
    }
};
