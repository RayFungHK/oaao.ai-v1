<?php

declare(strict_types=1);

/**
 * POST /user/api/users_invite_revoke — body { invitation_id }
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_admin_pg($this);
    if ($ctx === null) {
        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $invId = isset($body['invitation_id']) ? (int) $body['invitation_id'] : 0;
    if ($invId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'invitation_id required']);

        return;
    }

    $db = $ctx['db'];
    $tid = $ctx['tenant_id'];

    $st = $ctx['pdo']->prepare(
        'UPDATE oaao_user_invitation SET status = ? WHERE invitation_id = ? AND tenant_id = ? AND status = ?',
    );
    $st->execute(['revoked', $invId, $tid, 'pending']);

    echo json_encode(['success' => true]);
};
