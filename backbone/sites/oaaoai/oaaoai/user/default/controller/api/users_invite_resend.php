<?php

declare(strict_types=1);

use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserInvitationMail;
use oaaoai\user\UserInvitationSupport;

/**
 * POST /user/api/users_invite_resend — body { invitation_id }
 *
 * Revokes prior token and issues a new invitation email for the same address.
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

    $row = $db->prepare()
        ->select('invitation_id, email, role, permission_group_id, status')
        ->from('user_invitation')
        ->where('invitation_id=?,tenant_id=?')
        ->assign(['invitation_id' => $invId, 'tenant_id' => $tid])
        ->limit(1)
        ->query()
        ->fetch();

    if (! \is_array($row) || ($row['status'] ?? '') !== 'pending') {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Pending invitation not found']);

        return;
    }

    $ctx['pdo']->prepare(
        'UPDATE oaao_user_invitation SET status = ? WHERE invitation_id = ? AND tenant_id = ?',
    )->execute(['revoked', $invId, $tid]);

    $email = UserInvitationSupport::normalizeEmail((string) ($row['email'] ?? ''));
    $role = (string) ($row['role'] ?? 'user');
    $groupId = isset($row['permission_group_id']) ? (int) $row['permission_group_id'] : 0;

    $plainToken = UserInvitationSupport::issueToken();
    $tokenHash = UserInvitationSupport::hashToken($plainToken);
    $expiresAt = UserInvitationSupport::inviteExpiresAt();

    $db->insert('user_invitation', [
        'tenant_id',
        'email',
        'token_hash',
        'role',
        'permission_group_id',
        'invited_by_user_id',
        'status',
        'expires_at',
    ])
        ->assign([
            'tenant_id'            => $tid,
            'email'                => $email,
            'token_hash'           => $tokenHash,
            'role'                 => $role,
            'permission_group_id'  => $groupId > 0 ? $groupId : null,
            'invited_by_user_id'   => $ctx['uid'],
            'status'               => 'pending',
            'expires_at'           => $expiresAt,
        ])
        ->query();

    $newId = (int) $db->lastID();
    $registerUrl = UserInvitationSupport::inviteRegisterUrl($plainToken);
    $mailLocale = UserInvitationMail::normalizeMailLocale(
        UserDisplayPreferences::localeForUser($ctx['pdo'], (int) $ctx['uid']),
    );
    $mailResult = UserInvitationSupport::sendMail(
        $email,
        UserInvitationMail::inviteSubject($mailLocale),
        UserInvitationMail::inviteBody($registerUrl, $expiresAt, $mailLocale),
    );

    echo json_encode([
        'success'       => true,
        'invitation_id' => $newId > 0 ? $newId : null,
        'expires_at'    => $expiresAt,
        'mail_sent'     => $mailResult['sent'],
        'register_url'  => $mailResult['sent'] ? null : $registerUrl,
    ], JSON_UNESCAPED_UNICODE);
};
