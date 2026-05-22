<?php

/**
 * POST /chat/api/workspace_delete — owner deletes workspace (PostgreSQL row + adjunct SQLite threads for this workspace_id).
 *
 * Body JSON: `{ "workspace_id": number }`
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

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : 0;
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

    if (! \oaao_chat_workspace_is_owner($db, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Only the workspace owner can delete it']);

        return;
    }

    $splitDb = $authApi->getDBSplit();
    if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
        $authApi->ensureAdjunctSqliteLoaded();
        $splitDb = $authApi->getDBSplit();
    }

    try {
        $adj = ($splitDb && $splitDb->getDBAdapter() instanceof \PDO) ? $splitDb->getDBAdapter() : null;
        if ($adj instanceof \PDO) {
            require_once __DIR__ . '/_workspace_adjunct_cleanup.php';
            \oaao_chat_adjunct_purge_workspace_threads($adj, $wid);
        }

        $del = $pdo->prepare(
            'DELETE FROM oaao_workspace w
             USING oaao_workspace_member m
             WHERE w.workspace_id = m.workspace_id
               AND m.user_id = ?
               AND m.role = \'owner\'
               AND w.workspace_id = ?
               AND w.disabled = 0',
        );
        $del->execute([$uid, $wid]);
        if ($del->rowCount() < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Workspace not found']);

            return;
        }

        echo json_encode(['success' => true, 'workspace_id' => $wid]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspace_delete: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not delete workspace']);
    }
};
