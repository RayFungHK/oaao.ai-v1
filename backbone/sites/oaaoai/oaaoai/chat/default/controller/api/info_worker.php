<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatInfoWorker;
use oaaoai\chat\ChatTurnScores;
use oaaoai\chat\TurnScorerVersion;

/**
 * GET /chat/api/info_worker?conversation_id=&message_ids=324,325
 *
 * Unified [info] payload — turn scores, productivity worker status, strip items.
 * Pass comma-separated {@code message_ids} for assistant rows with pending [info] work.
 * Legacy {@code assistant_message_id} is merged into the list when {@code message_ids} is omitted.
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $watchMid = (int) ($_GET['assistant_message_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $auth = $this->api('auth');
    $canonDb = $auth ? $auth->getDB() : null;
    if (! $canonDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Canonical database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    try {
        $own = ChatConversationScope::findForUser($splitDb, $uid, $cid, $wid, 'id');
        if ($own === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found'], JSON_UNESCAPED_UNICODE);

            return;
        }

        /** @var list<int>|null $messageIds */
        $messageIds = null;
        if (isset($_GET['message_ids'])) {
            $messageIds = [];
            $raw = $_GET['message_ids'];
            if (\is_string($raw) && trim($raw) !== '') {
                foreach (explode(',', $raw) as $part) {
                    $mid = (int) trim($part);
                    if ($mid > 0) {
                        $messageIds[] = $mid;
                    }
                }
            }
            $messageIds = array_values(array_unique($messageIds));
        }

        $data = ChatInfoWorker::buildPayload(
            $splitDb,
            $canonDb,
            $uid,
            $cid,
            $watchMid > 0 ? $watchMid : null,
            $messageIds,
        );

        echo json_encode([
            'success' => true,
            'data'    => $data,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('info_worker failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load info worker data'], JSON_UNESCAPED_UNICODE);
    }
};
