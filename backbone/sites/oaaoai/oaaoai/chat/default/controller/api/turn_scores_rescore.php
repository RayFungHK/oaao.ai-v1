<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\chat\TurnScorerVersion;

/**
 * POST /chat/api/turn_scores_rescore — queue background IQS/ACCS for missing or stale turns.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $cid = (int) ($input['conversation_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id($input);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    /** Background rescore is optional — never hard-fail the chat UI when deps are down. */
    $softSkip = static function (string $reason) use ($cid): void {
        echo json_encode([
            'success'         => true,
            'conversation_id' => $cid,
            'queued'          => 0,
            'skipped'         => true,
            'skip_reason'     => $reason,
            'scorer_versions' => TurnScorerVersion::payload(),
        ], JSON_UNESCAPED_UNICODE);
    };

    $auth = $this->api('auth');
    $canonDb = $auth ? $auth->getDB() : null;
    if (! $canonDb instanceof \Razy\Database) {
        $softSkip('canonical_database_unavailable');

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
            ->select('id, role, content, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array{id: int, role: string, content: string, meta: array<string, mixed>|null}> $messages */
        $messages = [];
        if (\is_array($rawMessages)) {
            foreach ($rawMessages as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $mid = (int) ($row['id'] ?? 0);
                if ($mid < 1) {
                    continue;
                }
                $meta = null;
                $mj = $row['meta_json'] ?? null;
                if (\is_string($mj) && $mj !== '') {
                    $decoded = json_decode($mj, true);
                    $meta = \is_array($decoded) ? $decoded : null;
                }
                $messages[] = [
                    'id'      => $mid,
                    'role'    => strtolower(trim((string) ($row['role'] ?? ''))),
                    'content' => (string) ($row['content'] ?? ''),
                    'meta'    => $meta,
                ];
            }
        }

        /** @var array<int, array<string, mixed>> $scoreByTurn */
        $scoreByTurn = [];
        $rawScores = $canonDb->prepare()
            ->select(
                'turn_index, iqs, accs, iqs_dims_json, accs_dims_json, iqs_reasons_json, accs_reasons_json, scorer_version'
            )
            ->from('turn_score')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $cid])
            ->order('+turn_index')
            ->limit(500)
            ->query()
            ->fetchAll();
        if (\is_array($rawScores)) {
            foreach ($rawScores as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $ti = (int) ($row['turn_index'] ?? 0);
                if ($ti > 0) {
                    $scoreByTurn[$ti] = $row;
                }
            }
        }

        $history = [];
        $turnIndex = 0;
        $queue = [];
        foreach ($messages as $row) {
            $role = (string) ($row['role'] ?? '');
            $content = (string) ($row['content'] ?? '');
            if ($role === 'assistant') {
                $turnIndex += 1;
                $mid = (int) ($row['id'] ?? 0);
                if ($mid >= 1 && trim($content) !== '') {
                    $userMessage = '';
                    for ($i = \count($history) - 1; $i >= 0; $i -= 1) {
                        if (($history[$i]['role'] ?? '') === 'user') {
                            $userMessage = (string) ($history[$i]['content'] ?? '');
                            break;
                        }
                    }
                    $stored = $scoreByTurn[$turnIndex] ?? null;
                    $iqs = \is_array($stored) ? (float) ($stored['iqs'] ?? 0) : 0.0;
                    $accs = \is_array($stored) ? (float) ($stored['accs'] ?? 0) : 0.0;
                    $iqsDimsRaw = \is_array($stored)
                        ? (json_decode((string) ($stored['iqs_dims_json'] ?? '{}'), true) ?: [])
                        : [];
                    $accsDimsRaw = \is_array($stored)
                        ? (json_decode((string) ($stored['accs_dims_json'] ?? '{}'), true) ?: [])
                        : [];
                    $iqsDims = TurnScorerVersion::normalizeScoreDims(\is_array($iqsDimsRaw) ? $iqsDimsRaw : []);
                    $accsDims = TurnScorerVersion::normalizeScoreDims(\is_array($accsDimsRaw) ? $accsDimsRaw : []);
                    $iqsReasons = \is_array($stored) && isset($stored['iqs_reasons_json']) && $stored['iqs_reasons_json'] !== ''
                        ? (json_decode((string) $stored['iqs_reasons_json'], true) ?: [])
                        : [];
                    $iqsReasons = \is_array($iqsReasons) ? $iqsReasons : [];
                    $iqsAction = isset($iqsReasons['action']) && \is_string($iqsReasons['action']) ? $iqsReasons['action'] : '';
                    $storedVersion = \is_array($stored) ? (string) ($stored['scorer_version'] ?? '') : '';
                    $needsIqs = TurnScorerVersion::needsIqsRescore($storedVersion, $iqs, $iqsDims);
                    $needsAccs = TurnScorerVersion::needsAccsRescore($storedVersion, $accs, $accsDims, $iqsAction);
                    if ($needsIqs || $needsAccs) {
                        $meta = $row['meta'] ?? null;
                        $pipelineSnap = null;
                        if (\is_array($meta) && isset($meta['oaao_pipeline']) && \is_array($meta['oaao_pipeline'])) {
                            $pipelineSnap = $meta['oaao_pipeline'];
                        }
                        $queue[] = [
                            'assistant_message_id'  => $mid,
                            'turn_index'            => $turnIndex,
                            'user_message'          => $userMessage,
                            'assistant_content'     => $content,
                            'conversation_history'  => $history,
                            'pipeline_snap'         => $pipelineSnap,
                            'stored_version'        => $storedVersion,
                            'iqs'                   => $iqs,
                            'accs'                  => $accs,
                            'iqs_dims'              => $iqsDims,
                            'accs_dims'             => $accsDims,
                            'iqs_action'            => $iqsAction,
                            'needs_iqs'             => $needsIqs,
                            'needs_accs'            => $needsAccs,
                        ];
                    }
                }
            }
            if ($role === 'user' || $role === 'assistant' || $role === 'system') {
                $history[] = ['role' => $role, 'content' => $content];
            }
        }

        if ($queue === []) {
            echo json_encode([
                'success'         => true,
                'conversation_id' => $cid,
                'queued'          => 0,
                'scorer_versions' => TurnScorerVersion::payload(),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        $coachEndpoint = null;
        $endpointsApi = $this->api('endpoints');
        if ($endpointsApi && \method_exists($endpointsApi, 'resolveOrchestratorUiqePayload')) {
            $coachEndpoint = $endpointsApi->resolveOrchestratorUiqePayload();
        }

        try {
            $orchBase = ChatOrchestratorApi::internalBase();
        } catch (\Throwable) {
            $softSkip('orchestrator_not_configured');

            return;
        }
        if ($orchBase === '') {
            $softSkip('orchestrator_url_unconfigured');

            return;
        }

        /** @var list<array<string, mixed>> $slimQueue */
        $slimQueue = array_map(
            static fn (array $turn): array => TurnScorerVersion::prepareRescoreTurnPayload($turn),
            $queue,
        );

        $postRescore = static function (int $conversationId, array $turns) use ($coachEndpoint): ?array {
            return ChatOrchestratorApi::postInternalJson(
                '/v1/turn_scores/rescore',
                [
                    'conversation_id' => $conversationId,
                    'turns'           => $turns,
                    'coach_endpoint'  => $coachEndpoint,
                ],
                10,
            );
        };

        $resp = $postRescore($cid, $slimQueue);
        if (\is_array($resp) && ($resp['ok'] ?? false) === true) {
            echo json_encode([
                'success'          => true,
                'conversation_id'  => $cid,
                'queued'           => (int) ($resp['queued'] ?? \count($slimQueue)),
                'already_running'  => (bool) ($resp['already_running'] ?? false),
                'scorer_versions'  => $resp['scorer_versions'] ?? TurnScorerVersion::payload(),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        $queued = 0;
        $alreadyRunning = false;
        $lastDetail = 'orchestrator_unreachable';
        $lastStatus = 0;
        if (\is_array($resp)) {
            $lastDetail = (string) ($resp['detail'] ?? $resp['message'] ?? 'orchestrator_error');
            $lastStatus = (int) ($resp['http_status'] ?? 0);
        }

        if (\count($slimQueue) > 1) {
            foreach ($slimQueue as $turn) {
                $one = $postRescore($cid, [$turn]);
                if (\is_array($one) && ($one['ok'] ?? false) === true) {
                    $queued += max(1, (int) ($one['queued'] ?? 1));
                    $alreadyRunning = $alreadyRunning || (bool) ($one['already_running'] ?? false);
                } elseif (\is_array($one)) {
                    $lastDetail = (string) ($one['detail'] ?? $one['message'] ?? $lastDetail);
                    $lastStatus = (int) ($one['http_status'] ?? $lastStatus);
                }
            }
        }

        if ($queued > 0) {
            echo json_encode([
                'success'          => true,
                'conversation_id'  => $cid,
                'queued'           => $queued,
                'already_running'  => $alreadyRunning,
                'partial'          => true,
                'scorer_versions'  => TurnScorerVersion::payload(),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        echo json_encode([
            'success'             => true,
            'conversation_id'     => $cid,
            'queued'              => 0,
            'skipped'             => true,
            'skip_reason'         => 'orchestrator_rescore_unavailable',
            'orchestrator_detail' => $lastDetail,
            'orchestrator_status' => $lastStatus,
            'turns_requested'     => \count($slimQueue),
            'scorer_versions'     => TurnScorerVersion::payload(),
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('turn_scores_rescore failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Rescore queue failed'], JSON_UNESCAPED_UNICODE);
    }
};
