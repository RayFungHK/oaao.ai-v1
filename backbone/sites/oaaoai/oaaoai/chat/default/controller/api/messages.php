<?php

/**
 * GET /chat/api/messages?conversation_id=&workspace_id= — messages for a conversation owned by the user in that scope.
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

    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

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
            ->select('id, role, content, created_at, feedback, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();
        /** @var list<array<string, mixed>> $rows */
        $rows = \is_array($raw) ? $raw : [];
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $mj = $row['meta_json'] ?? null;
            unset($row['meta_json']);
            $row['meta'] = null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                $row['meta'] = \is_array($decoded) ? $decoded : null;
            }
            $out[] = $row;
        }
        echo json_encode(['success' => true, 'messages' => $out]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load messages']);
    }
};
