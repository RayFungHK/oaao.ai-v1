<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationHealth;
use oaaoai\chat\TurnScorerVersion;

/**
 * POST /chat/api/turn_score_upsert — merge IQS / ACCS into {@code oaao_turn_score} (orchestrator internal).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    if (! \is_string($hdr) || $hdr === '' || ! hash_equals($secret, $hdr)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mid = (int) ($input['assistant_message_id'] ?? 0);
    $plugin = strtolower(trim((string) ($input['plugin'] ?? '')));
    if ($cid < 1 || $mid < 1 || ! \in_array($plugin, ['iqs', 'accs'], true)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'conversation_id, assistant_message_id, plugin (iqs|accs) required',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }
    if (method_exists($auth, 'ensureAdjunctSqliteLoaded')) {
        $auth->ensureAdjunctSqliteLoaded();
    }
    $canonDb = $auth->getDB();
    if (! $canonDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Canonical database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $splitDb = $auth->getDBSplit();
    if (! $splitDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Split database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $turnIndex = $this->oaao_chat_turn_index_for_message($splitDb, $cid, $mid);
    if ($turnIndex < 1) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Assistant message not found'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $scorerVersion = trim((string) ($input['scorer_version'] ?? TurnScorerVersion::IQS));
    if ($scorerVersion === '') {
        $scorerVersion = TurnScorerVersion::IQS;
    }
    $scoredAt = microtime(true);

    $existing = $canonDb->prepare()
        ->select('iqs, accs, iqs_dims_json, accs_dims_json, iqs_reasons_json, accs_reasons_json, scorer_version, topic_shift')
        ->from('turn_score')
        ->where('conversation_id=?,turn_index=?')
        ->assign(['conversation_id' => $cid, 'turn_index' => $turnIndex])
        ->query()
        ->fetch();

    $iqs = 0.0;
    $accs = 0.0;
    $iqsDims = '{}';
    $accsDims = '{}';
    $iqsReasons = null;
    $accsReasons = null;

    if (\is_array($existing)) {
        $iqs = (float) ($existing['iqs'] ?? 0);
        $accs = (float) ($existing['accs'] ?? 0);
        $iqsDims = (string) ($existing['iqs_dims_json'] ?? '{}');
        $accsDims = (string) ($existing['accs_dims_json'] ?? '{}');
        $iqsReasons = $existing['iqs_reasons_json'] ?? null;
        $accsReasons = $existing['accs_reasons_json'] ?? null;
    }

    if ($plugin === 'iqs') {
        $iqs = (float) ($input['iqs'] ?? $iqs);
        $iqsDims = json_encode($input['iqs_dims_json'] ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (isset($input['iqs_reasons_json'])) {
            $iqsReasons = json_encode($input['iqs_reasons_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }
    } else {
        $accs = (float) ($input['accs'] ?? $accs);
        $accsDims = json_encode($input['accs_dims_json'] ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (isset($input['accs_reasons_json'])) {
            $accsReasons = json_encode($input['accs_reasons_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }
    }

    $topicShift = \is_array($existing) ? (int) ($existing['topic_shift'] ?? 0) : 0;
    if ($plugin === 'accs') {
        if (array_key_exists('topic_shift', $input)) {
            $topicShift = (int) $input['topic_shift'] ? 1 : 0;
        } else {
            $accsDimsArr = json_decode($accsDims, true);
            $accsDimsArr = \is_array($accsDimsArr) ? $accsDimsArr : [];
            $userMsg = '';
            $prevRows = $splitDb->prepare()
                ->select('id, content')
                ->from('message')
                ->where('conversation_id=?,role=?')
                ->assign([
                    'conversation_id' => $cid,
                    'role'            => 'user',
                ])
                ->order('-id')
                ->limit(8)
                ->query()
                ->fetchAll();
            if (\is_array($prevRows)) {
                foreach ($prevRows as $prevRow) {
                    if (! \is_array($prevRow)) {
                        continue;
                    }
                    $prevId = (int) ($prevRow['id'] ?? 0);
                    if ($prevId > 0 && $prevId < $mid) {
                        $userMsg = (string) ($prevRow['content'] ?? '');
                        break;
                    }
                }
            }
            $topicShift = ChatConversationHealth::topicShiftFlag($userMsg, $accsDimsArr, $accs);
        }
    }

    try {
        $existingVersion = \is_array($existing) ? (string) ($existing['scorer_version'] ?? '') : '';
        $scorerVersion = TurnScorerVersion::merge($existingVersion, $plugin, $scorerVersion);
        if (\is_array($existing)) {
            $updateCols = [
                'iqs',
                'accs',
                'iqs_dims_json',
                'accs_dims_json',
                'iqs_reasons_json',
                'accs_reasons_json',
                'scorer_version',
                'scored_at',
            ];
            $updateAssign = [
                'iqs'               => $iqs,
                'accs'              => $accs,
                'iqs_dims_json'     => $iqsDims,
                'accs_dims_json'    => $accsDims,
                'iqs_reasons_json'  => $iqsReasons,
                'accs_reasons_json' => $accsReasons,
                'scorer_version'    => $scorerVersion,
                'scored_at'         => $scoredAt,
                'conversation_id'   => $cid,
                'turn_index'        => $turnIndex,
            ];
            if ($plugin === 'accs') {
                $updateCols[] = 'topic_shift';
                $updateAssign['topic_shift'] = $topicShift;
            }
            $canonDb->update('turn_score', $updateCols)
                ->where('conversation_id=?,turn_index=?')
                ->assign($updateAssign)
                ->query();
        } else {
            $canonDb->insert('turn_score', [
                'conversation_id',
                'turn_index',
                'iqs',
                'accs',
                'iqs_dims_json',
                'accs_dims_json',
                'iqs_reasons_json',
                'accs_reasons_json',
                'scorer_version',
                'scored_at',
                'complete',
                'topic_shift',
            ])
                ->assign([
                    'conversation_id'   => $cid,
                    'turn_index'        => $turnIndex,
                    'iqs'               => $iqs,
                    'accs'              => $accs,
                    'iqs_dims_json'     => $iqsDims,
                    'accs_dims_json'    => $accsDims,
                    'iqs_reasons_json'  => $iqsReasons,
                    'accs_reasons_json' => $accsReasons,
                    'scorer_version'    => $scorerVersion,
                    'scored_at'         => $scoredAt,
                    'complete'          => 1,
                    'topic_shift'       => $plugin === 'accs' ? $topicShift : 0,
                ])
                ->query();
        }
    } catch (\Throwable $e) {
        error_log('turn_score_upsert failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Persist failed'], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success'      => true,
        'turn_index'   => $turnIndex,
        'conversation_id' => $cid,
    ], JSON_UNESCAPED_UNICODE);
};
