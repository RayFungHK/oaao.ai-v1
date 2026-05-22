<?php

declare(strict_types=1);

/**
 * POST /chat/api/conversation_mode — persist thread UI mode (desk vs default) in params_json.
 *
 * Body JSON: { "conversation_id": int, "mode": "desk"|"default", "workspace_id"?: int|null }
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
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mode = isset($input['mode']) && is_string($input['mode']) ? strtolower(trim($input['mode'])) : '';
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }
    if (! \in_array($mode, ['desk', 'default'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mode must be desk or default']);

        return;
    }

    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $row = $splitDb->prepare()
            ->select('id, params_json')
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

        $params = [];
        $raw = $row['params_json'] ?? null;
        if (\is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (\is_array($decoded)) {
                $params = $decoded;
            }
        }
        $params['mode'] = $mode;

        $splitDb->update('conversation', ['params_json', 'updated_at'])
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign([
                'params_json'  => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at'   => date('Y-m-d H:i:s'),
                'id'           => $cid,
                'user_id'      => $uid,
                'workspace_id' => $wid,
            ])
            ->query();

        echo json_encode(['success' => true, 'conversation_id' => $cid, 'mode' => $mode]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not update conversation mode']);
    }
};
