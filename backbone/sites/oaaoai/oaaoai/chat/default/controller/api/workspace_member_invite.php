<?php

use Oaaoai\Core\NotificationRepository;

/**
 * POST /chat/api/workspace_member_invite — owner invites by email (immediate membership if user exists, else pending invitation + token link).
 *
 * Body JSON: `{ "workspace_id": number, "email": string }`
 */
return function (): void {
    [$authApi, $user] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $user) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $db = $authApi->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $authApi->ensurePgCoreTables($db);

    if (! $authApi->databaseIsPgsql($db)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Team workspaces require PostgreSQL.']);

        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $authApi->ensurePgWorkspaceTables($pdo);

    require_once __DIR__ . '/_workspace_team_pg.php';

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : 0;
    $emailRaw = trim((string) ($input['email'] ?? ''));
    $emailNorm = \oaao_chat_workspace_normalize_email($emailRaw);
    $roleRaw = strtolower(trim((string) ($input['role'] ?? 'member')));
    $inviteRole = $roleRaw === 'owner' ? 'owner' : 'member';

    if ($wid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'workspace_id required']);

        return;
    }

    if ($emailNorm === '' || ! filter_var($emailNorm, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Valid email required']);

        return;
    }

    if (! \oaao_chat_workspace_is_owner($db, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Only workspace owners can invite']);

        return;
    }

    try {
        /** @var array<string, mixed>|false $targetRow */
        $targetRow = $db->prepare()
            ->select('user_id')
            ->from('user')
            ->where('email IS NOT NULL, email=:em')
            ->assign(['em' => $emailNorm])
            ->limit(1)
            ->query()
            ->fetch();
        $targetUid = \is_array($targetRow) && isset($targetRow['user_id'])
            ? (int) $targetRow['user_id']
            : 0;

        if ($targetUid > 0) {
            if ($targetUid === $uid) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Cannot invite yourself']);

                return;
            }

            /** @var array<string, mixed>|false $memRow */
            $memRow = $db->prepare()
                ->select('1 AS ok')
                ->from('workspace_member')
                ->where('workspace_id=:wid, user_id=:uid')
                ->assign(['wid' => $wid, 'uid' => $targetUid])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($memRow)) {
                echo json_encode([
                    'success' => true,
                    'mode'    => 'already_member',
                    'message' => 'User is already a member',
                ]);

                return;
            }

            $db->insert('workspace_member', ['workspace_id', 'user_id', 'role'])
                ->assign([
                    'workspace_id' => $wid,
                    'user_id'      => $targetUid,
                    'role'         => $inviteRole,
                ])
                ->query();

            $this->api('auth')->ensureNotificationSchema($pdo);
            /** @var array<string, mixed>|false $wsRow */
            $wsRow = $db->prepare()
                ->select('name')
                ->from('workspace')
                ->where('workspace_id=:wid')
                ->assign(['wid' => $wid])
                ->limit(1)
                ->query()
                ->fetch();
            $wsName = \is_array($wsRow) && isset($wsRow['name']) ? (string) $wsRow['name'] : 'Workspace';
            $notifRepo = new NotificationRepository($pdo);
            $notifRepo->create(
                $targetUid,
                'invitation',
                'Added to workspace',
                "You were added to \"{$wsName}\" as {$inviteRole}.",
                ['workspace_id' => $wid, 'role' => $inviteRole],
            );

            echo json_encode([
                'success' => true,
                'mode'    => 'member_added',
                'user_id' => $targetUid,
                'role'    => $inviteRole,
            ]);

            return;
        }

        $nowIso = (new \DateTimeImmutable('now'))->format('Y-m-d H:i:s');

        /** @var array<string, mixed>|false $dupRow */
        $dupRow = $db->prepare()
            ->select('invitation_id')
            ->from('workspace_invitation')
            ->where('workspace_id=:wid, invitee_email=:em, status=:st, expires_at>:ts')
            ->assign([
                'wid' => $wid,
                'em'  => $emailNorm,
                'st'  => 'pending',
                'ts'  => $nowIso,
            ])
            ->limit(1)
            ->query()
            ->fetch();
        if (\is_array($dupRow) && isset($dupRow['invitation_id'])) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'An invitation is already pending for this email']);

            return;
        }

        $token = bin2hex(random_bytes(24));
        $expiresAt = (new \DateTimeImmutable('+7 days'))->format('Y-m-d H:i:s');

        try {
            $db->insert('workspace_invitation', [
                'workspace_id',
                'invited_by',
                'invitee_email',
                'token',
                'status',
                'expires_at',
                'role',
            ])
                ->assign([
                    'workspace_id'   => $wid,
                    'invited_by'     => $uid,
                    'invitee_email'  => $emailNorm,
                    'token'          => $token,
                    'status'         => 'pending',
                    'expires_at'     => $expiresAt,
                    'role'           => $inviteRole,
                ])
                ->query();
        } catch (\Razy\Exception\QueryException $e) {
            $prev = $e->getPrevious();
            if ($prev instanceof \PDOException) {
                $info = $prev->errorInfo;
                $state = (string) ($info[0] ?? '');
                if ($state === '23505' || str_contains(strtolower($prev->getMessage()), 'unique')) {
                    http_response_code(409);
                    echo json_encode(['success' => false, 'message' => 'An invitation is already pending for this email']);

                    return;
                }
            }
            throw $e;
        }

        $invitationId = $db->lastID();

        echo json_encode([
            'success'       => true,
            'mode'          => 'invite_created',
            'invitation_id' => $invitationId > 0 ? $invitationId : null,
            'token'         => $token,
            'expires_at'    => $expiresAt,
            'invitee_email' => $emailNorm,
            'role'          => $inviteRole,
        ]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_member_invite: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not send invitation']);
    }
};
