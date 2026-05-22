<?php

/**
 * POST /chat/api/workspace_member_remove — owner removes a member (non-owner rows only).
 *
 * Body JSON: `{ "workspace_id": number, "user_id": number }`
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
    $rm = isset($input['user_id']) ? (int) $input['user_id'] : 0;

    if ($wid < 1 || $rm < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'workspace_id and user_id required']);

        return;
    }

    if (! \oaao_chat_workspace_is_owner($db, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Only workspace owners can remove members']);

        return;
    }

    try {
        $chk = $pdo->prepare(
            'SELECT role FROM oaao_workspace_member WHERE workspace_id = ? AND user_id = ? LIMIT 1',
        );
        $chk->execute([$wid, $rm]);
        $roleRaw = $chk->fetchColumn();
        $role = \is_string($roleRaw) ? $roleRaw : '';
        if ($role === '') {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Member not found']);

            return;
        }

        if ($role === 'owner') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Cannot remove workspace owner']);

            return;
        }

        $del = $pdo->prepare(
            'DELETE FROM oaao_workspace_member WHERE workspace_id = ? AND user_id = ? AND role <> \'owner\'',
        );
        $del->execute([$wid, $rm]);
        if ($del->rowCount() < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Member not found']);

            return;
        }

        echo json_encode(['success' => true, 'workspace_id' => $wid, 'user_id' => $rm]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_member_remove: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not remove member']);
    }
};
