<?php

declare(strict_types=1);

/**
 * GET /chat/api/task_artifacts?conversation_id=&task_id=
 *
 * Aggregates {@code meta_json.oaao_pipeline.artifacts} from assistant rows for one logical or run task id.
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $taskId = isset($_GET['task_id']) && is_string($_GET['task_id']) ? trim($_GET['task_id']) : '';
    if ($uid < 1 || $cid < 1 || $taskId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and task_id required']);

        return;
    }

    try {
        $own = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($own) || ! isset($own['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $raw = $splitDb->prepare()
            ->select('id, role, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array<string, mixed>> $rows */
        $rows = \is_array($raw) ? $raw : [];

        $artifacts = \oaaoai\chat\ChatTaskArtifacts::collectFromMessages($rows, $taskId);

        echo json_encode([
            'success' => true,
            'artifacts' => $artifacts,
            'task_id' => $taskId,
            'conversation_id' => $cid,
        ]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load task artifacts']);
    }
};
