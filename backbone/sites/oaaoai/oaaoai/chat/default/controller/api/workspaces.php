<?php

/**
 * GET /chat/api/workspaces — list PostgreSQL workspaces the signed-in user belongs to (Personal scope is implicit on the client).
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
        echo json_encode([
            'success'            => true,
            'workspaces'       => [],
            'postgres_required' => true,
            'message'          => 'Team workspaces require PostgreSQL.',
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

    try {
        /**
         * Prefer owner membership row when legacy installs duplicated {@code oaao_workspace_member}
         * (same workspace_id + user_id).
         */
        $sql = <<<'SQL'
SELECT DISTINCT ON (w.workspace_id)
    w.workspace_id,
    w.name,
    w.updated_at::text AS updated_at,
    m.role
FROM oaao_workspace w
INNER JOIN oaao_workspace_member m ON m.workspace_id = w.workspace_id AND m.user_id = ?
WHERE w.disabled = 0
ORDER BY w.workspace_id,
    CASE WHEN m.role = 'owner' THEN 0 WHEN m.role = 'member' THEN 1 ELSE 2 END
SQL;
        $listSt = $pdo->prepare($sql);
        $listSt->execute([$uid]);
        /** @var list<array<string, mixed>> $rows */
        $rows = $listSt->fetchAll(\PDO::FETCH_ASSOC);

        usort(
            $rows,
            static function (array $a, array $b): int {
                $na = strtolower((string) ($a['name'] ?? ''));
                $nb = strtolower((string) ($b['name'] ?? ''));
                if ($na !== $nb) {
                    return $na <=> $nb;
                }

                return ((int) ($a['workspace_id'] ?? 0)) <=> ((int) ($b['workspace_id'] ?? 0));
            },
        );

        echo json_encode([
            'success'      => true,
            'workspaces'   => $rows,
            'postgres_required' => false,
        ]);
    } catch (\Throwable $e) {
        error_log('oaaoai/chat workspaces list: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not load workspaces']);
    }
};
