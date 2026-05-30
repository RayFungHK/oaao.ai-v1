<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatTurnScores;
use oaaoai\chat\TurnScorerVersion;

/**
 * GET /chat/api/turn_scores?conversation_id= — IQS/ACCS rows for thread UI (Phase 4).
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

        $pack = ChatTurnScores::loadForConversation($splitDb, $canonDb, $cid);

        echo json_encode([
            'success'         => true,
            'conversation_id' => $cid,
            'scorer_versions' => TurnScorerVersion::payload(),
            'rescore_pending' => (int) ($pack['rescore_pending'] ?? 0),
            'scores'          => $pack['scores'] ?? [],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('turn_scores list failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load turn scores'], JSON_UNESCAPED_UNICODE);
    }
};
