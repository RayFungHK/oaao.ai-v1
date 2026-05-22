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
        // Split SQLite adjunct — newest activity first ({@code >} = DESC in Razy order DSL).
        $includeArchived = isset($_GET['include_archived']) && (string) $_GET['include_archived'] === '1';
        if ($includeArchived) {
            $raw = $splitDb->prepare()
                ->select('id, title, workspace_id, created_at, updated_at, archived, params_json')
                ->from('conversation')
                ->where('user_id=?,workspace_id=?')
                ->assign(['user_id' => $uid, 'workspace_id' => $wid])
                ->order('>updated_at,>created_at')
                ->limit(200)
                ->query()
                ->fetchAll();
        } else {
            $raw = $splitDb->prepare()
                ->select('id, title, workspace_id, created_at, updated_at, archived, params_json')
                ->from('conversation')
                ->where('user_id=?,workspace_id=?,archived=?')
                ->assign(['user_id' => $uid, 'workspace_id' => $wid, 'archived' => 0])
                ->order('>updated_at,>created_at')
                ->limit(200)
                ->query()
                ->fetchAll();
        }
        /** @var list<array<string, mixed>> $rows */
        $rows = \is_array($raw) ? $raw : [];
        $conversations = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $mode = 'default';
            $paramsRaw = $row['params_json'] ?? null;
            if (\is_string($paramsRaw) && $paramsRaw !== '') {
                $decoded = json_decode($paramsRaw, true);
                if (\is_array($decoded) && isset($decoded['mode']) && $decoded['mode'] === 'desk') {
                    $mode = 'desk';
                }
            }
            unset($row['params_json']);
            $row['mode'] = $mode;
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
