<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationHealth;
use oaaoai\chat\ChatConversationScope;

/**
 * GET /chat/api/conversation_health?conversation_id= — thread IQS/ACCS trends and alerts (P1-9).
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

        $rawMessages = $splitDb->prepare()
            ->select('id, role, content')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var array<int, string> $userByTurn */
        $userByTurn = [];
        $turn = 0;
        $pendingUser = '';
        if (\is_array($rawMessages)) {
            foreach ($rawMessages as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                $content = (string) ($row['content'] ?? '');
                if ($role === 'user') {
                    $pendingUser = $content;
                    continue;
                }
                if ($role !== 'assistant') {
                    continue;
                }
                $turn += 1;
                $userByTurn[$turn] = $pendingUser;
            }
        }

        $rawScores = $canonDb->prepare()
            ->select('turn_index, iqs, accs, accs_dims_json, topic_shift')
            ->from('turn_score')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+turn_index')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array<string, mixed>> $scoreRows */
        $scoreRows = [];
        if (\is_array($rawScores)) {
            foreach ($rawScores as $row) {
                if (\is_array($row)) {
                    $scoreRows[] = $row;
                }
            }
        }

        $health = ChatConversationHealth::analyze($cid, $scoreRows, $userByTurn);

        echo json_encode([
            'success' => true,
            'data'    => $health,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('conversation_health failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load conversation health'], JSON_UNESCAPED_UNICODE);
    }
};
