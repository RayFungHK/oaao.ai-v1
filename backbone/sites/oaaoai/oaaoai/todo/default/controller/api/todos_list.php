<?php

declare(strict_types=1);

/**
 * GET /todo/api/todos_list?status=open|done|all&workspace_id=&conversation_id=
 */
return function (): void {
    require_once __DIR__ . '/_todo_api_bootstrap.php';

    $ctx = oaao_todo_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $uid = (int) $ctx['uid'];
    $statusFilter = trim((string) ($_GET['status'] ?? 'open'));
    if (! \in_array($statusFilter, ['open', 'done', 'cancelled', 'all'], true)) {
        $statusFilter = 'open';
    }

    $widRaw = $_GET['workspace_id'] ?? null;
    $workspaceId = null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $convRaw = $_GET['conversation_id'] ?? null;
    $conversationId = null;
    if ($convRaw !== null && $convRaw !== '' && (int) $convRaw > 0) {
        $conversationId = (int) $convRaw;
    }

    $sql = 'SELECT todo_id, title, status, priority, due_at, context_snippet,
                   conversation_id, message_id, workspace_id, completed_at, created_at, updated_at
            FROM oaao_todo_item
            WHERE tenant_id = ? AND user_id = ?';
    $params = [$tenantId, $uid];

    if ($statusFilter !== 'all') {
        $sql .= ' AND status = ?';
        $params[] = $statusFilter;
    }
    if ($workspaceId !== null) {
        $sql .= ' AND workspace_id = ?';
        $params[] = $workspaceId;
    }
    if ($conversationId !== null) {
        $sql .= ' AND conversation_id = ?';
        $params[] = $conversationId;
    }

    $sql .= ' ORDER BY CASE status WHEN \'open\' THEN 0 ELSE 1 END, due_at NULLS LAST, updated_at DESC LIMIT 200';

    $st = $ctx['pdo']->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC);

    $openCount = 0;
    if (\is_array($rows)) {
        foreach ($rows as $row) {
            if (\is_array($row) && ($row['status'] ?? '') === 'open') {
                ++$openCount;
            }
        }
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'todos'      => \is_array($rows) ? $rows : [],
            'open_count' => $openCount,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
