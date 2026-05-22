<?php

/**
 * POST /chat/api/conversation_share — ensure adjunct conversation has a share_slug (same owner session opens via GET resolve_share).
 *
 * Body JSON: { "conversation_id": int }
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
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    try {
        $row = $splitDb->prepare()
            ->select('id, share_slug')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row) || ! isset($row['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $existing = isset($row['share_slug']) ? trim((string) $row['share_slug']) : '';
        if ($existing !== '') {
            echo json_encode(['success' => true, 'conversation_id' => $cid, 'share_slug' => $existing]);

            return;
        }

        $slug = '';
        for ($attempt = 0; $attempt < 12; $attempt++) {
            $try = bin2hex(random_bytes(10));
            $hit = $splitDb->prepare()
                ->select('id')
                ->from('conversation')
                ->where('share_slug=?')
                ->assign(['share_slug' => $try])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($hit) || ! isset($hit['id'])) {
                $slug = $try;

                break;
            }
        }
        if ($slug === '') {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not allocate share slug']);

            return;
        }

        $splitDb->update('conversation', ['share_slug'])
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign([
                'share_slug'   => $slug,
                'id'           => $cid,
                'user_id'      => $uid,
                'workspace_id' => $wid,
            ])
            ->query();

        echo json_encode(['success' => true, 'conversation_id' => $cid, 'share_slug' => $slug]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Share failed']);
    }
};
