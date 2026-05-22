<?php

/**
 * GET /chat/api/workspace_team?workspace_id=
 *
 * Members see roster; owners additionally see pending invitations (Open WebUI-style team panel).
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

    $wid = isset($_GET['workspace_id']) ? (int) $_GET['workspace_id'] : 0;
    if ($wid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'workspace_id required']);

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

    $role = \oaao_chat_workspace_member_role($db, $uid, $wid);
    if ($role === null) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Not a member of this workspace']);

        return;
    }

    try {
        $wsSt = $pdo->prepare(
            'SELECT workspace_id, name, updated_at::text AS updated_at FROM oaao_workspace WHERE workspace_id = ? AND disabled = 0 LIMIT 1',
        );
        $wsSt->execute([$wid]);
        /** @var array<string, mixed>|false $ws */
        $ws = $wsSt->fetch(\PDO::FETCH_ASSOC);
        if (! \is_array($ws)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Workspace not found']);

            return;
        }

        $memSt = $pdo->prepare(
            'SELECT u.user_id, u.email, u.display_name, m.role, m.joined_at::text AS joined_at
             FROM oaao_workspace_member m
             INNER JOIN oaao_user u ON u.user_id = m.user_id
             WHERE m.workspace_id = ?
             ORDER BY CASE WHEN m.role = \'owner\' THEN 0 ELSE 1 END, lower(u.email)',
        );
        $memSt->execute([$wid]);
        /** @var list<array<string, mixed>> $members */
        $members = $memSt->fetchAll(\PDO::FETCH_ASSOC);

        /** @var list<array<string, mixed>> $invites */
        $invites = [];
        if ($role === 'owner') {
            $inSt = $pdo->prepare(
                'SELECT invitation_id, invitee_email, expires_at::text AS expires_at, created_at::text AS created_at
                 FROM oaao_workspace_invitation
                 WHERE workspace_id = ? AND status = \'pending\' AND expires_at > CURRENT_TIMESTAMP
                 ORDER BY created_at DESC',
            );
            $inSt->execute([$wid]);
            $invites = $inSt->fetchAll(\PDO::FETCH_ASSOC);
        }

        echo json_encode([
            'success'      => true,
            'workspace_id' => (int) ($ws['workspace_id'] ?? $wid),
            'name'         => (string) ($ws['name'] ?? ''),
            'updated_at'   => isset($ws['updated_at']) ? (string) $ws['updated_at'] : '',
            'my_role'      => $role,
            'members'      => $members,
            'invitations'  => $invites,
        ]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_team: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not load workspace team']);
    }
};
