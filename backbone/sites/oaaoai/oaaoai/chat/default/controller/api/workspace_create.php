<?php

/**
 * POST /chat/api/workspace_create — create workspace + owner membership (PostgreSQL).
 *
 * Body JSON: `{ "name": string }`
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
    $name = trim((string) ($input['name'] ?? ''));
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
        require_once dirname(__DIR__, 4) . '/core/default/library/GroupLimitEnforcer.php';

        $limits = \Oaaoai\Core\GroupLimitEnforcer::limitsForUser($pdo, $uid);
        $limitMsg = \Oaaoai\Core\GroupLimitEnforcer::assertCanCreateWorkspace($pdo, $uid, $limits);
        if ($limitMsg !== null) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => $limitMsg]);

            return;
        }

        $pdo->beginTransaction();
        $ins = $pdo->prepare(
            'INSERT INTO oaao_workspace (name, created_by, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) RETURNING workspace_id',
        );
        $ins->execute([$name, $uid]);
        /** @var array|false $rw */
        $rw = $ins->fetch(\PDO::FETCH_ASSOC);
        $wid = isset($rw['workspace_id']) ? (int) $rw['workspace_id'] : 0;
        if ($wid < 1) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not create workspace']);

            return;
        }
        $mem = $pdo->prepare(
            'INSERT INTO oaao_workspace_member (workspace_id, user_id, role) VALUES (?, ?, ?)',
        );
        $mem->execute([$wid, $uid, 'owner']);
        $pdo->commit();

        echo json_encode([
            'success'   => true,
            'workspace' => [
                'workspace_id' => $wid,
                'name'         => $name,
                'role'         => 'owner',
            ],
        ]);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('oaaoai/chat workspace_create: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not create workspace']);
    }
};
