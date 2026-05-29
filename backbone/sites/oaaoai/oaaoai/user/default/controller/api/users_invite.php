<?php

declare(strict_types=1);

use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserInvitationMail;
use oaaoai\user\UserInvitationSupport;

/**
 * POST /user/api/users_invite — admin sends tenant user invitation (no password).
 *
 * Body: { email, role?, permission_group_id? }
 */
return function (): void {
    require_once __DIR__ . '/_user_api_bootstrap.php';

    $ctx = oaao_user_require_admin_pg($this);
    if ($ctx === null) {
        return;
    }

    $db = $ctx['db'];
    $tid = $ctx['tenant_id'];
    $uid = $ctx['uid'];

    if (UserInvitationSupport::countRecentInvitesByAdmin($db, $tid, $uid, 1) >= 10) {
        http_response_code(429);
        echo json_encode(['success' => false, 'message' => 'Too many invitations; try again later']);

        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $email = UserInvitationSupport::normalizeEmail((string) ($body['email'] ?? ''));
    if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Valid email required']);

        return;
    }

    $role = trim((string) ($body['role'] ?? 'user'));
    if ($role !== 'admin') {
        $role = 'user';
    }

    $groupId = isset($body['permission_group_id']) ? (int) $body['permission_group_id'] : 0;
    if ($groupId < 1) {
        $groupId = 0;
    }

    if ($groupId > 0) {
        $gOk = $db->prepare()
            ->select('id')
            ->from('group')
            ->where('id=?,tenant_id=:tid')
            ->assign(['id' => $groupId, 'tid' => $tid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($gOk)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid permission group']);

            return;
        }
    }

    $userWhere = 'email IS NOT NULL, email=:em';
    $userParams = ['em' => $email];
    if ($tid > 0) {
        $userWhere .= ',tenant_id=:tid';
        $userParams['tid'] = $tid;
    }
    $existing = $db->prepare()
        ->select('user_id')
        ->from('user')
        ->where($userWhere)
        ->assign($userParams)
        ->limit(1)
        ->query()
        ->fetch();
    if (\is_array($existing)) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'A user with this email already exists']);

        return;
    }

    $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    $pending = $db->prepare()
        ->select('invitation_id')
        ->from('user_invitation')
        ->where('tenant_id=:tid, email=:em, status=:st, expires_at>:ts')
        ->assign([
            'tid' => $tid,
            'em'  => $email,
            'st'  => 'pending',
            'ts'  => $nowIso,
        ])
        ->limit(1)
        ->query()
        ->fetch();
    if (\is_array($pending)) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'An invitation is already pending for this email']);

        return;
    }

    $plainToken = UserInvitationSupport::issueToken();
    $tokenHash = UserInvitationSupport::hashToken($plainToken);
    $expiresAt = UserInvitationSupport::inviteExpiresAt();

    try {
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
                'invited_by_user_id'   => $uid,
                'status'               => 'pending',
                'expires_at'           => $expiresAt,
            ])
            ->query();
    } catch (\Throwable $e) {
        error_log('oaaoai/user users_invite: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not create invitation']);

        return;
    }

    $invitationId = (int) $db->lastID();
    $registerUrl = UserInvitationSupport::inviteRegisterUrl($plainToken);
    $mailLocale = UserInvitationMail::normalizeMailLocale(
        trim((string) ($body['mail_locale'] ?? '')) !== ''
            ? (string) $body['mail_locale']
            : UserDisplayPreferences::localeForUser($ctx['pdo'], $uid),
    );
    $mail = UserInvitationMail::inviteBody($registerUrl, $expiresAt, $mailLocale);
    $mailResult = UserInvitationSupport::sendMail(
        $email,
        UserInvitationMail::inviteSubject($mailLocale),
        $mail,
    );

    echo json_encode([
        'success'        => true,
        'invitation_id'  => $invitationId > 0 ? $invitationId : null,
        'email'          => $email,
        'expires_at'     => $expiresAt,
        'mail_sent'      => $mailResult['sent'],
        'register_url'   => $mailResult['sent'] ? null : $registerUrl,
    ], JSON_UNESCAPED_UNICODE);
};
