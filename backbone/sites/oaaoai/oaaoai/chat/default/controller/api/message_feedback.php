<?php

/**
 * POST /chat/api/message_feedback — like / clear like on adjunct message (owner via conversation).
 *
 * Body JSON: { "conversation_id": int, "message_id": int, "feedback": "like" | null | "" }
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
    $mid = (int) ($input['message_id'] ?? 0);
    $fbRaw = $input['feedback'] ?? null;
    $fb = (\is_string($fbRaw) && strtolower(trim($fbRaw)) === 'like') ? 'like' : '';

    if ($cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and message_id required']);

        return;
    }

    try {
        $conv = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($conv) || ! isset($conv['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $splitDb->update('message', ['feedback'])
            ->where('id=?,conversation_id=?')
            ->assign([
                'feedback'          => $fb === '' ? '' : $fb,
                'id'                => $mid,
                'conversation_id'   => $cid,
            ])
            ->query();

        echo json_encode(['success' => true, 'message_id' => $mid, 'feedback' => $fb === '' ? null : $fb]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Feedback failed']);
    }
};
