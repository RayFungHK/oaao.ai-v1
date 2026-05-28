<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationMail;
use oaaoai\user\UserInvitationSupport;

/**
 * POST /user/api/password_reset_request — body { email }; always 200 (no enumeration).
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_pg_public($this);
    if ($ctx === null) {
        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $email = UserInvitationSupport::normalizeEmail((string) ($body['email'] ?? ''));

    $generic = [
        'success' => true,
        'message' => 'If an account exists for this email, a reset link has been sent.',
    ];

    if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode($generic, JSON_UNESCAPED_UNICODE);

        return;
    }

    $core = $this->api('core');
    $tenantId = $core ? $core->bootstrapTenantContext($ctx['pdo']) : 0;

    $where = 'email IS NOT NULL, email=:em, !disabled';
    $params = ['em' => $email];
    if ($tenantId > 0) {
        $where .= ',tenant_id=:tid';
        $params['tid'] = $tenantId;
    }

    $row = $ctx['db']->prepare()
        ->select('user_id')
        ->from('user')
        ->where($where)
        ->assign($params)
        ->limit(1)
        ->query()
        ->fetch();

    if (! \is_array($row) || (int) ($row['user_id'] ?? 0) < 1) {
        echo json_encode($generic, JSON_UNESCAPED_UNICODE);

        return;
    }

    $userId = (int) $row['user_id'];
    $plainToken = UserInvitationSupport::issueToken();
    $tokenHash = UserInvitationSupport::hashToken($plainToken);
    $expiresAt = UserInvitationSupport::resetExpiresAt();

    $ctx['pdo']->prepare(
        'UPDATE oaao_password_reset SET status = ? WHERE user_id = ? AND status = ?',
    )->execute(['expired', $userId, 'pending']);

    $ctx['db']->insert('password_reset', ['user_id', 'token_hash', 'status', 'expires_at'])
        ->assign([
            'user_id'    => $userId,
            'token_hash' => $tokenHash,
            'status'     => 'pending',
            'expires_at' => $expiresAt,
        ])
        ->query();

    $resetUrl = UserInvitationSupport::resetPasswordUrl($plainToken);
    UserInvitationSupport::sendMail(
        $email,
        UserInvitationMail::resetSubject(),
        UserInvitationMail::resetBody($resetUrl, $expiresAt),
    );

    echo json_encode($generic, JSON_UNESCAPED_UNICODE);
};
