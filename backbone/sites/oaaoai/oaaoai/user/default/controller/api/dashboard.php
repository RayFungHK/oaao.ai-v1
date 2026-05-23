<?php

declare(strict_types=1);

use Oaaoai\Core\CreditLedgerRepository;

/**
 * GET /user/api/dashboard — personal usage + credit summary (30 days).
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
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Usage dashboard requires PostgreSQL']);

        return;
    }

    $core = $this->api('core');
    $tid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
    if ($tid < 1 && $core) {
        $tid = $core->bootstrapTenantContext($pdo);
    }
    if ($tid < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context unavailable']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/core/default/library/CreditLedgerRepository.php';

    $uid = (int) ($user->user_id ?? 0);
    $data = CreditLedgerRepository::userDashboard($pdo, $tid, $uid);

    echo json_encode(['success' => true, 'data' => $data]);
};
