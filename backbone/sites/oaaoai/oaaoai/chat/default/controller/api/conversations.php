<?php

/**
 * GET /chat/api/conversations — list conversations for the signed-in user in the active scope ({@code workspace_id} query, optional — {@code null} = personal).
 */
return function (): void {
    [$authApi, $user] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $user) {
        return;
    }

    $splitDb = $authApi->getDBSplit();
    if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
        $authApi->ensureAdjunctSqliteLoaded();
        $splitDb = $authApi->getDBSplit();
    }
    $pdo = ($splitDb && $splitDb->getDBAdapter() instanceof \PDO) ? $splitDb->getDBAdapter() : null;
    if (! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        echo json_encode([
            'success'                => true,
            'conversations'          => [],
            'adjunct_sqlite_ready'  => false,
            'message'                => 'Adjunct SQLite unavailable — check writable auth/data/ or sqlite_local.database (Docker paths such as /var/www/… only work inside the container).',
        ]);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);

    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $includeArchived = isset($_GET['include_archived']) && (string) $_GET['include_archived'] === '1';
        $rows = \oaaoai\chat\ChatConversationScope::listForUser(
            $splitDb,
            $uid,
            $wid,
            $includeArchived,
        );
        $conversations = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $mode = 'default';
            $plannerModeId = 'default';
            $paramsRaw = $row['params_json'] ?? null;
            if (\is_string($paramsRaw) && $paramsRaw !== '') {
                $decoded = json_decode($paramsRaw, true);
                if (\is_array($decoded)) {
                    if (isset($decoded['mode']) && $decoded['mode'] === 'desk') {
                        $mode = 'desk';
                    }
                    $pm = strtolower(trim((string) ($decoded['planner_mode_id'] ?? '')));
                    if (\in_array($pm, ['default', 'tot', 'ddtree'], true)) {
                        $plannerModeId = $pm;
                    }
                }
            }
            unset($row['params_json']);
            $row['mode'] = $mode;
            $row['planner_mode_id'] = $plannerModeId;
            $conversations[] = $row;
        }
        echo json_encode([
            'success'               => true,
            'conversations'         => $conversations,
            'adjunct_sqlite_ready' => true,
        ]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load conversations']);
    }
};
