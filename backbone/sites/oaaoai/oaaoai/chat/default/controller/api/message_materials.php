<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationMaterial;

/**
 * GET /chat/api/message_materials?conversation_id=&message_id=
 *
 * Materials for one assistant turn (indexed from meta on {@see assistant_patch}).
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $this->ensureConversationMaterialSchema($pdo);

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $mid = (int) ($_GET['message_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and message_id required']);

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

        $msg = $splitDb->prepare()
            ->select('id, role, meta_json')
            ->from('message')
            ->where('id=?,conversation_id=?')
            ->assign(['id' => $mid, 'conversation_id' => $cid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($msg) || ! isset($msg['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Message not found']);

            return;
        }
        if (strtolower((string) ($msg['role'] ?? '')) !== 'assistant') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'message_id must be an assistant message']);

            return;
        }

        $materials = ChatConversationMaterial::listForMessage($pdo, $cid, $mid);
        if ($materials === []) {
            $mj = $msg['meta_json'] ?? null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                if (\is_array($decoded)) {
                    ChatConversationMaterial::syncFromMessageMeta($pdo, $cid, $mid, $decoded);
                    $materials = ChatConversationMaterial::listForMessage($pdo, $cid, $mid);
                }
            }
        }

        echo json_encode([
            'success'       => true,
            'materials'     => $materials,
            'message_id'    => $mid,
            'conversation_id' => $cid,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load materials']);
    }
};
