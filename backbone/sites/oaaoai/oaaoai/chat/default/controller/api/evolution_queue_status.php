<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\chat\TurnScorerVersion;

/**
 * GET /chat/api/evolution_queue_status — background IQS/ACCS rescore + post-stream pool snapshot.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $persistedStats = [
        'turn_scores_total'     => 0,
        'turn_scores_with_iqs'  => 0,
        'turn_scores_with_accs' => 0,
        'latest_conversation_id' => null,
        'latest_turn_index'      => null,
        'latest_scored_at'       => null,
    ];

    $auth = $this->api('auth');
    $canonDb = $auth ? $auth->getDB() : null;
    if ($canonDb instanceof \Razy\Database) {
        try {
            $countRow = $canonDb->prepare()
                ->select('COUNT(*) AS total, SUM(CASE WHEN iqs > 0 THEN 1 ELSE 0 END) AS with_iqs, SUM(CASE WHEN accs > 0 THEN 1 ELSE 0 END) AS with_accs')
                ->from('turn_score')
                ->query()
                ->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($countRow)) {
                $persistedStats['turn_scores_total'] = (int) ($countRow['total'] ?? 0);
                $persistedStats['turn_scores_with_iqs'] = (int) ($countRow['with_iqs'] ?? 0);
                $persistedStats['turn_scores_with_accs'] = (int) ($countRow['with_accs'] ?? 0);
            }

            $latestRow = $canonDb->prepare()
                ->select('conversation_id, turn_index, scored_at')
                ->from('turn_score')
                ->order('-scored_at')
                ->limit(1)
                ->query()
                ->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($latestRow)) {
                $lcid = (int) ($latestRow['conversation_id'] ?? 0);
                $lti = (int) ($latestRow['turn_index'] ?? 0);
                $lsa = (float) ($latestRow['scored_at'] ?? 0);
                if ($lcid > 0) {
                    $persistedStats['latest_conversation_id'] = $lcid;
                }
                if ($lti > 0) {
                    $persistedStats['latest_turn_index'] = $lti;
                }
                if ($lsa > 0) {
                    $persistedStats['latest_scored_at'] = $lsa;
                }
            }
        } catch (\Throwable $e) {
            error_log('evolution_queue_status persisted stats failed: ' . $e->getMessage());
        }
    }

    $resp = ChatOrchestratorApi::getInternalJson('/v1/work_queues/status', 12);
    if (! \is_array($resp) || ($resp['ok'] ?? false) !== true) {
        echo json_encode([
            'success'                       => true,
            'orchestrator_ok'             => false,
            'scorer_versions'             => TurnScorerVersion::payload(),
            'turn_score_rescore'          => ['active_count' => 0, 'active' => []],
            'post_stream_pools'           => [],
            'evolution_post_stream_enabled' => null,
            'persisted_turn_scores'       => $persistedStats,
            'generated_at'                => microtime(true),
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success'                       => true,
        'orchestrator_ok'               => true,
        'scorer_versions'               => $resp['scorer_versions'] ?? TurnScorerVersion::payload(),
        'evolution_post_stream_enabled' => $resp['evolution_post_stream_enabled'] ?? null,
        'turn_score_rescore'            => $resp['turn_score_rescore'] ?? ['active_count' => 0, 'active' => []],
        'post_stream_pools'             => $resp['post_stream_pools'] ?? [],
        'persisted_turn_scores'         => $persistedStats,
        'generated_at'                  => (float) ($resp['generated_at'] ?? microtime(true)),
    ], JSON_UNESCAPED_UNICODE);
};
