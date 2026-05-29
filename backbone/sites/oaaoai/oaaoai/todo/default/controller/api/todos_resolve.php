<?php

declare(strict_types=1);

/**
 * POST /todo/api/todos_resolve — mark todo done (CS-6-S7).
 *
 * Body: { todo_id }
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

    $todoId = (int) ($input['todo_id'] ?? 0);
    if ($todoId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'todo_id required']);

        return;
    }

    $now = date('Y-m-d H:i:s');
    $st = $ctx['pdo']->prepare(
        'UPDATE oaao_todo_item
         SET status = ?, completed_at = ?, updated_at = ?
         WHERE todo_id = ? AND tenant_id = ? AND user_id = ? AND status = ?',
    );
    $st->execute(['done', $now, $now, $todoId, $ctx['tenant_id'], $ctx['uid'], 'open']);

    if ($st->rowCount() < 1) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Open todo not found']);

        return;
    }

    echo json_encode(['success' => true, 'data' => ['todo_id' => $todoId, 'status' => 'done']], JSON_UNESCAPED_UNICODE);
};
