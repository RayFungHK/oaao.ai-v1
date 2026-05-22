<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationMaterial;

/**
 * GET /chat/api/conversation_materials?conversation_id=
 *
 * Slide projects + recent file materials for library / continuation (SD-5).
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

        require_once dirname(__DIR__, 2) . '/library/ChatConversationMaterial.php';
        $limit = (int) ($_GET['limit'] ?? 16);
        $materials = ChatConversationMaterial::catalogForPlanner(
            $pdo,
            $cid,
            $uid,
            $limit,
            $this->api('slide_designer'),
        );

        echo json_encode([
            'success'          => true,
            'conversation_id'  => $cid,
            'materials'        => $materials,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load materials']);
    }
};
