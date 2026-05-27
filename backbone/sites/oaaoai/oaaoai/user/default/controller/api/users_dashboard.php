<?php

declare(strict_types=1);

use Oaaoai\Core\CreditLedgerRepository;

/**
 * GET /user/api/users_dashboard?user_id= — administrator: per-user usage + credit summary.
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
    if (! $auth->requireAdmin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Administrator required']);

        return;
    }

    $userId = (int) ($_GET['user_id'] ?? 0);
    if ($userId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'user_id is required']);

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
    $tid = 0;
    if ($core) {
        $tid = $core->bootstrapTenantContext($pdo);
    }
    if ($tid < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context unavailable']);

        return;
    }

    $stmt = $pdo->prepare(
        'SELECT user_id, login_name, display_name, email FROM oaao_user WHERE user_id = ? AND tenant_id = ? LIMIT 1',
    );
    $stmt->execute([$userId, $tid]);
    $userRow = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($userRow)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'User not found']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/core/default/library/CreditLedgerRepository.php';

    $dashboard = CreditLedgerRepository::userDashboard($pdo, $tid, $userId);

    echo json_encode([
        'success' => true,
        'data'    => array_merge($dashboard, [
            'user_id'      => $userId,
            'login_name'   => (string) ($userRow['login_name'] ?? ''),
            'display_name' => (string) ($userRow['display_name'] ?? ''),
            'email'        => (string) ($userRow['email'] ?? ''),
        ]),
    ], JSON_UNESCAPED_UNICODE);
};
