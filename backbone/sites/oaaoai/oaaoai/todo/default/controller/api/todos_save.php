<?php

declare(strict_types=1);

/**
 * POST /todo/api/todos_save — create or update todo.
 */
return function (): void {
    require_once __DIR__ . '/_todo_api_bootstrap.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_todo_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $uid = (int) $ctx['uid'];
    $todoId = isset($input['todo_id']) ? (int) $input['todo_id'] : 0;
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'title required']);

        return;
    }
    $title = mb_substr($title, 0, 512);

    $status = trim((string) ($input['status'] ?? 'open'));
    if (! \in_array($status, ['open', 'done', 'cancelled'], true)) {
        $status = 'open';
    }
    $priority = trim((string) ($input['priority'] ?? 'normal'));
    if (! \in_array($priority, ['low', 'normal', 'high'], true)) {
        $priority = 'normal';
    }

    $dueAt = trim((string) ($input['due_at'] ?? ''));
    $dueVal = $dueAt !== '' ? $dueAt : null;
    $context = trim((string) ($input['context_snippet'] ?? ''));
    $contextVal = $context !== '' ? mb_substr($context, 0, 2000) : null;

    $widRaw = $input['workspace_id'] ?? null;
    $workspaceId = $widRaw !== null && $widRaw !== '' && (int) $widRaw > 0 ? (int) $widRaw : null;
    $conversationId = isset($input['conversation_id']) && (int) $input['conversation_id'] > 0
        ? (int) $input['conversation_id']
        : null;
    $messageId = isset($input['message_id']) && (int) $input['message_id'] > 0
        ? (int) $input['message_id']
        : null;

    $pdo = $ctx['pdo'];
    $now = date('Y-m-d H:i:s');
    $completedAt = $status === 'done' ? $now : null;

    if ($todoId > 0) {
        $st = $pdo->prepare(
            'UPDATE oaao_todo_item
             SET title = ?, status = ?, priority = ?, due_at = ?, context_snippet = ?,
                 completed_at = ?, updated_at = ?
             WHERE todo_id = ? AND tenant_id = ? AND user_id = ?',
        );
        $st->execute([
            $title,
            $status,
            $priority,
            $dueVal,
            $contextVal,
            $completedAt,
            $now,
            $todoId,
            $tenantId,
            $uid,
        ]);
        if ($st->rowCount() < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Todo not found']);

            return;
        }
        $outId = $todoId;
    } else {
        $st = $pdo->prepare(
            'INSERT INTO oaao_todo_item (
                tenant_id, user_id, workspace_id, title, status, priority, due_at,
                context_snippet, conversation_id, message_id, completed_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING todo_id',
        );
        $st->execute([
            $tenantId,
            $uid,
            $workspaceId,
            $title,
            $status,
            $priority,
            $dueVal,
            $contextVal,
            $conversationId,
            $messageId,
            $completedAt,
            $now,
            $now,
        ]);
        $outId = (int) $st->fetchColumn();
    }

    $fetch = $pdo->prepare(
        'SELECT todo_id, title, status, priority, due_at, context_snippet,
                conversation_id, message_id, workspace_id, completed_at, created_at, updated_at
         FROM oaao_todo_item WHERE todo_id = ? AND tenant_id = ? AND user_id = ? LIMIT 1',
    );
    $fetch->execute([$outId, $tenantId, $uid]);
    $row = $fetch->fetch(\PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data'    => ['todo' => \is_array($row) ? $row : ['todo_id' => $outId]],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
