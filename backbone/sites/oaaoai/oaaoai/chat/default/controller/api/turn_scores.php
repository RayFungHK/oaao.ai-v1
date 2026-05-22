<?php

declare(strict_types=1);

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
            echo json_encode(['success' => false, 'message' => 'Conversation not found'], JSON_UNESCAPED_UNICODE);

            return;
        }

        $assistantIds = $splitDb->prepare()
            ->select('id')
            ->from('message')
            ->where('conversation_id=?,role=assistant')
            ->assign(['conversation_id' => $cid])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();
        /** @var array<int, int> $turnIndexToMessageId */
        $turnIndexToMessageId = [];
        $turn = 0;
        if (\is_array($assistantIds)) {
            foreach ($assistantIds as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $mid = (int) ($row['id'] ?? 0);
                if ($mid < 1) {
                    continue;
                }
                $turn += 1;
                $turnIndexToMessageId[$turn] = $mid;
            }
        }

        $rawScores = $canonDb->prepare()
            ->select(
                'turn_index, iqs, accs, iqs_dims_json, accs_dims_json, iqs_reasons_json, accs_reasons_json, scorer_version, scored_at, complete, topic_shift'
            )
            ->from('turn_score')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+turn_index')
            ->limit(500)
            ->query()
            ->fetchAll();

        $scores = [];
        if (\is_array($rawScores)) {
            foreach ($rawScores as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $ti = (int) ($row['turn_index'] ?? 0);
                $mid = $turnIndexToMessageId[$ti] ?? 0;
                $iqsDims = $row['iqs_dims_json'] ?? '{}';
                $accsDims = $row['accs_dims_json'] ?? '{}';
                $iqsReasons = $row['iqs_reasons_json'] ?? null;
                $accsReasons = $row['accs_reasons_json'] ?? null;
                $scores[] = [
                    'turn_index'            => $ti,
                    'assistant_message_id'  => $mid > 0 ? $mid : null,
                    'iqs'                   => (float) ($row['iqs'] ?? 0),
                    'accs'                  => (float) ($row['accs'] ?? 0),
                    'iqs_dims'              => json_decode(\is_string($iqsDims) ? $iqsDims : '{}', true) ?: [],
                    'accs_dims'             => json_decode(\is_string($accsDims) ? $accsDims : '{}', true) ?: [],
                    'iqs_reasons'           => $iqsReasons !== null && $iqsReasons !== ''
                        ? (json_decode((string) $iqsReasons, true) ?: [])
                        : [],
                    'accs_reasons'          => $accsReasons !== null && $accsReasons !== ''
                        ? (json_decode((string) $accsReasons, true) ?: [])
                        : [],
                    'scorer_version'        => (string) ($row['scorer_version'] ?? ''),
                    'scored_at'             => (float) ($row['scored_at'] ?? 0),
                    'complete'              => (int) ($row['complete'] ?? 1),
                    'topic_shift'           => (int) ($row['topic_shift'] ?? 0),
                ];
            }
        }

        echo json_encode([
            'success'         => true,
            'conversation_id' => $cid,
            'scores'          => $scores,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('turn_scores list failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load turn scores'], JSON_UNESCAPED_UNICODE);
    }
};
