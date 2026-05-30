<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;

/**
 * GET /chat/api/message_prompt_debug?conversation_id=&message_id=
 *
 * Returns {@code orchestrator_prompt_debug} captured at send (PHP payload) and optional compose inject (Python).
 */
return function (): void {
    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

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
        $own = ChatConversationScope::findForUser($splitDb, $uid, $cid, $wid, 'id');
        if ($own === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $row = $splitDb->prepare()
            ->select('id, role, content, meta_json, created_at')
            ->from('message')
            ->where('id=?,conversation_id=?')
            ->assign(['id' => $mid, 'conversation_id' => $cid])
            ->limit(1)
            ->query()
            ->fetch();

        if (! \is_array($row) || ($row['role'] ?? '') !== 'assistant') {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Assistant message not found']);

            return;
        }

        /** @var array<string, mixed>|null $meta */
        $meta = null;
        $rawMeta = $row['meta_json'] ?? null;
        if (\is_string($rawMeta) && $rawMeta !== '') {
            try {
                $decoded = json_decode($rawMeta, true, 512, JSON_THROW_ON_ERROR);
                $meta = \is_array($decoded) ? $decoded : null;
            } catch (\JsonException) {
                $meta = null;
            }
        }

        $debug = \is_array($meta) && isset($meta['orchestrator_prompt_debug']) && \is_array($meta['orchestrator_prompt_debug'])
            ? $meta['orchestrator_prompt_debug']
            : null;

        echo json_encode([
            'success'                  => true,
            'conversation_id'          => $cid,
            'message_id'               => $mid,
            'created_at'               => $row['created_at'] ?? null,
            'orchestrator_prompt_debug' => $debug,
            'has_debug'                => $debug !== null && $debug !== [],
        ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load prompt debug']);
    }
};
