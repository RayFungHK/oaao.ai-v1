<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationSupport;

/**
 * GET /user/api/register_validate?token= — public; returns email hint when token valid.
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_pg_public($this);
    if ($ctx === null) {
        return;
    }

    $plain = trim((string) ($_GET['token'] ?? ''));
    if ($plain === '' || ! preg_match('/^[a-f0-9]{64}$/i', $plain)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid token']);

        return;
    }

    $hash = UserInvitationSupport::hashToken($plain);
    $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');

    $row = $ctx['db']->prepare()
        ->select('invitation_id, email, role, expires_at, tenant_id')
        ->from('user_invitation')
        ->where('token_hash=:th, status=:st, expires_at>:ts')
        ->assign(['th' => $hash, 'st' => 'pending', 'ts' => $nowIso])
        ->limit(1)
        ->query()
        ->fetch();

    if (! \is_array($row)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invitation expired or invalid']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'email'      => (string) ($row['email'] ?? ''),
            'role'       => (string) ($row['role'] ?? 'user'),
            'expires_at' => (string) ($row['expires_at'] ?? ''),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
