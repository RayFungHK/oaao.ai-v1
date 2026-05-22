<?php

/**
 * POST /chat/api/workspace_invitation_revoke — owner revokes a pending invitation.
 *
 * Body JSON: `{ "invitation_id": number }`
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
    $invId = isset($input['invitation_id']) ? (int) $input['invitation_id'] : 0;
    if ($invId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'invitation_id required']);

        return;
    }

    try {
        $st = $pdo->prepare(
            'SELECT i.workspace_id FROM oaao_workspace_invitation i
             WHERE i.invitation_id = ? AND i.status = \'pending\' LIMIT 1',
        );
        $st->execute([$invId]);
        $widRaw = $st->fetchColumn();
        $wid = \is_numeric($widRaw) ? (int) $widRaw : 0;
        if ($wid < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Invitation not found']);

            return;
        }

        if (! \oaao_chat_workspace_is_owner($db, $uid, $wid)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Only workspace owners can revoke invitations']);

            return;
        }

        $upd = $pdo->prepare(
            'UPDATE oaao_workspace_invitation SET status = \'revoked\' WHERE invitation_id = ? AND workspace_id = ? AND status = \'pending\'',
        );
        $upd->execute([$invId, $wid]);
        if ($upd->rowCount() < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Invitation not found']);

            return;
        }

        echo json_encode(['success' => true, 'invitation_id' => $invId]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_invitation_revoke: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not revoke invitation']);
    }
};
