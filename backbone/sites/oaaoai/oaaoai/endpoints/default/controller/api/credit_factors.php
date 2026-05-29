<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\CreditFactorsCatalog;

/**
 * GET /endpoints/api/credit_factors — administrator: all credit ratios and MM factors.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! ($pdo instanceof \PDO)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $isPgsql = $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';

    if ($isPgsql) {
        require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);
        require_once __DIR__ . '/../../../../chat/default/controller/api/_ensure_chat_profile_tables.php';
        oaao_chat_ensure_profile_tables($db);
    }

    $tenantId = 0;
    $auth = $this->api('auth');
    $user = $auth?->getUser();
    if ($user && isset($user->tenant_id)) {
        $tenantId = (int) $user->tenant_id;
    }

    try {
        $repo = $isPgsql ? new CanonicalEndpointsRepository($db, $this->api('core')) : null;
        if ($repo !== null) {
            $repo->ensureChatPrimaryPurposeRow();
        }
        echo json_encode(
            [
                'success' => true,
                'data'    => CreditFactorsCatalog::catalogForAdmin($pdo, $tenantId, $repo, $isPgsql),
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    } catch (\Throwable $e) {
        error_log(sprintf('[credit_factors] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load credit catalog'], JSON_UNESCAPED_UNICODE);
    }
};
