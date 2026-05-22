<?php

/**
 * POST /chat/api/workspace_invite_accept — signed-in user accepts invite token (session email must match invitee_email).
 *
 * Body JSON: `{ "token": string }`
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

    $sessionEmail = \oaao_chat_workspace_normalize_email((string) ($user->email ?? ''));
    if ($sessionEmail === '') {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'Your profile needs an email address to accept workspace invitations.',
        ]);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $token = trim((string) ($input['token'] ?? ''));
    if ($token === '' || strlen($token) > 96 || ! ctype_xdigit($token)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid invitation token']);

        return;
    }

    try {
        $pdo->beginTransaction();

        $invSt = $pdo->prepare(
            'SELECT invitation_id, workspace_id, invitee_email
             FROM oaao_workspace_invitation
             WHERE token = ? AND status = \'pending\' AND expires_at > CURRENT_TIMESTAMP
             LIMIT 1 FOR UPDATE',
        );
        $invSt->execute([$token]);
        /** @var array<string, mixed>|false $inv */
        $inv = $invSt->fetch(\PDO::FETCH_ASSOC);
        if (! \is_array($inv)) {
            $pdo->rollBack();
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Invitation expired or already used']);

            return;
        }

        $inviteEmail = \oaao_chat_workspace_normalize_email((string) ($inv['invitee_email'] ?? ''));
        if ($inviteEmail !== $sessionEmail) {
            $pdo->rollBack();
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'message' => 'This invitation was sent to a different email — switch accounts or ask for a new invite.',
            ]);

            return;
        }

        $wid = (int) ($inv['workspace_id'] ?? 0);
        $invId = (int) ($inv['invitation_id'] ?? 0);
        if ($wid < 1 || $invId < 1) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Invalid invitation']);

            return;
        }

        $wsSt = $pdo->prepare(
            'SELECT name FROM oaao_workspace WHERE workspace_id = ? AND disabled = 0 LIMIT 1',
        );
        $wsSt->execute([$wid]);
        $wsNameRaw = $wsSt->fetchColumn();
        $wsName = \is_string($wsNameRaw) ? $wsNameRaw : '';

        $memIns = $pdo->prepare(
            'INSERT INTO oaao_workspace_member (workspace_id, user_id, role) VALUES (?, ?, \'member\')
             ON CONFLICT (workspace_id, user_id) DO NOTHING',
        );
        $memIns->execute([$wid, $uid]);

        $upd = $pdo->prepare(
            'UPDATE oaao_workspace_invitation SET status = \'accepted\', accepted_at = CURRENT_TIMESTAMP, accepted_user_id = ?
             WHERE invitation_id = ? AND status = \'pending\'',
        );
        $upd->execute([$uid, $invId]);

        $pdo->commit();

        echo json_encode([
            'success'      => true,
            'workspace_id' => $wid,
            'name'         => $wsName,
        ]);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('oaaoai/chat workspace_invite_accept: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not accept invitation']);
    }
};
