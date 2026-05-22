<?php

/**
 * POST /chat/api/workspace_update — rename workspace (owners only).
 *
 * Body JSON: `{ "workspace_id": number, "name": string }`
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
        echo json_encode([
            'success' => false,
            'message' => 'Team workspaces require PostgreSQL as the canonical database.',
        ]);

        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $authApi->ensurePgWorkspaceTables($pdo);

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : 0;
    $name = trim((string) ($input['name'] ?? ''));

    if ($wid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'workspace_id required']);

        return;
    }
    if ($name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Workspace name required']);

        return;
    }
    if (mb_strlen($name) > 120) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Workspace name too long']);

        return;
    }

    try {
        $chk = $pdo->prepare(
            'SELECT 1 FROM oaao_workspace_member WHERE workspace_id = ? AND user_id = ? AND role = ? LIMIT 1',
        );
        $chk->execute([$wid, $uid, 'owner']);
        if (! (bool) $chk->fetchColumn()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Only workspace owners can rename']);

            return;
        }

        $upd = $pdo->prepare(
            'UPDATE oaao_workspace SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND disabled = 0',
        );
        $upd->execute([$name, $wid]);

        $exists = $pdo->prepare('SELECT 1 FROM oaao_workspace WHERE workspace_id = ? AND disabled = 0 LIMIT 1');
        $exists->execute([$wid]);
        if (! (bool) $exists->fetchColumn()) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Workspace not found']);

            return;
        }

        echo json_encode([
            'success' => true,
            'workspace' => [
                'workspace_id' => $wid,
                'name'         => $name,
            ],
        ]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_update: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not update workspace']);
    }
};
