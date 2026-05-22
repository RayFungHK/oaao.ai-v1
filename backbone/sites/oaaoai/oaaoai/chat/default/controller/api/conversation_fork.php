<?php

declare(strict_types=1);

/**
 * POST /chat/api/conversation_fork — branch a desk-mode thread for a different agent/mode.
 *
 * Body JSON: { "conversation_id": int, "workspace_id"?: int|null }
 */
return function (): void {
    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $parentId = (int) ($input['conversation_id'] ?? 0);
    if ($parentId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $parent = $splitDb->prepare()
            ->select('id, title, params_json')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $parentId, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($parent) || ! isset($parent['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $baseTitle = trim((string) ($parent['title'] ?? ''));
        if ($baseTitle === '') {
            $baseTitle = 'Chat';
        }
        $title = mb_substr($baseTitle . ' · new mode', 0, 120);

        $params = [
            'mode'        => 'default',
            'forked_from' => $parentId,
        ];
        $paramsJson = json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $now = date('Y-m-d H:i:s');
        $splitDb->insert('conversation', ['user_id', 'workspace_id', 'title', 'params_json', 'created_at', 'updated_at'])
            ->assign([
                'user_id'      => $uid,
                'workspace_id' => $wid,
                'title'        => $title,
                'params_json'  => $paramsJson,
                'created_at'   => $now,
                'updated_at'   => $now,
            ])
            ->query();

        $newId = (int) $splitDb->lastID();
        if ($newId < 1) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not fork conversation']);

            return;
        }

        echo json_encode([
            'success'               => true,
            'conversation_id'       => $newId,
            'parent_conversation_id' => $parentId,
        ]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not fork conversation']);
    }
};
