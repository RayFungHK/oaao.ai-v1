<?php

/**
 * POST /chat/api/conversation_archive — set adjunct conversation archived flag (owner only).
 *
 * Body JSON: { "conversation_id": int, "archived": bool, "workspace_id"?: int }
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $cid = (int) ($input['conversation_id'] ?? 0);
    $archived = ! empty($input['archived']);

    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    try {
        $splitDb->update('conversation', ['archived'])
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign([
                'archived'    => $archived ? 1 : 0,
                'id'          => $cid,
                'user_id'     => $uid,
                'workspace_id' => $wid,
            ])
            ->query();
        echo json_encode(['success' => true, 'conversation_id' => $cid, 'archived' => $archived]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Archive failed']);
    }
};
