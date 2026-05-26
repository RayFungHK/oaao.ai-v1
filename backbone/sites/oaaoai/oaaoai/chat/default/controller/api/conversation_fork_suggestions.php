<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationHealth;
use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /chat/api/conversation_fork_suggestions?conversation_id= — planner/coach fork starters (thread health).
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
        /** @var list<array{role: string, content: string}> $recentMessages */
        $recentMessages = [];
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
                    $recentMessages[] = ['role' => 'user', 'content' => $content];
                    continue;
                }
                if ($role !== 'assistant') {
                    continue;
                }
                $recentMessages[] = ['role' => 'assistant', 'content' => $content];
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
        $alert = (string) ($health['alert'] ?? 'none');
        if ($alert === '' || $alert === 'none') {
            echo json_encode([
                'success' => true,
                'data'    => [
                    'intro'        => '',
                    'suggestions'  => [],
                    'source'       => 'none',
                    'alert'        => 'none',
                ],
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        $coachEndpoint = null;
        $endpointsApi = $this->api('endpoints');
        if ($endpointsApi && \method_exists($endpointsApi, 'resolveOrchestratorUiqePayload')) {
            $coachEndpoint = $endpointsApi->resolveOrchestratorUiqePayload();
        }

        $tailMessages = \array_slice($recentMessages, -12);
        $localeHint = '';
        for ($i = \count($tailMessages) - 1; $i >= 0; $i--) {
            if (($tailMessages[$i]['role'] ?? '') === 'user' && trim((string) ($tailMessages[$i]['content'] ?? '')) !== '') {
                $localeHint = (string) $tailMessages[$i]['content'];
                break;
            }
        }

        $fallback = [
            'intro'       => '對話中話題可能開始偏離，或 AI 對你的輸入理解不夠準確。可以選以下其中一則開場建立新 Chat：',
            'suggestions' => [],
            'source'      => 'heuristic',
            'alert'       => $alert,
        ];

        if (ChatOrchestratorApi::internalBase() === '') {
            echo json_encode(['success' => true, 'data' => $fallback], JSON_UNESCAPED_UNICODE);

            return;
        }

        $resp = ChatOrchestratorApi::postInternalJson(
            '/v1/conversation/fork_suggestions',
            [
                'conversation_id'  => $cid,
                'alert'            => $alert,
                'health'           => $health,
                'recent_messages'  => $tailMessages,
                'locale_hint'      => $localeHint,
                'coach_endpoint'   => $coachEndpoint,
            ],
            35,
        );

        if (! \is_array($resp) || ($resp['ok'] ?? false) !== true) {
            echo json_encode(['success' => true, 'data' => $fallback], JSON_UNESCAPED_UNICODE);

            return;
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'intro'       => (string) ($resp['intro'] ?? $fallback['intro']),
                'suggestions' => \is_array($resp['suggestions'] ?? null) ? array_values($resp['suggestions']) : [],
                'source'      => (string) ($resp['source'] ?? 'coach'),
                'alert'       => $alert,
            ],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('conversation_fork_suggestions failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load fork suggestions'], JSON_UNESCAPED_UNICODE);
    }
};
