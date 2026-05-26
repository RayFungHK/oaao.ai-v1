<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /mine/api/run_now — trigger orchestrator mine worker.
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }

    $mineId = isset($input['mine_id']) ? (int) $input['mine_id'] : 0;
    if ($mineId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mine_id required']);

        return;
    }

    $repo = new MineRepository($ctx['db']);
    $mine = $repo->getMine($mineId, $ctx['tenant_id'], $ctx['uid']);
    if ($mine === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Mine not found']);

        return;
    }

    $sources = $repo->listSources($mineId);
    $runId = $repo->insertRun([
        'mine_id'    => $mineId,
        'status'     => 'running',
        'started_at' => gmdate('Y-m-d H:i:s'),
        'created_at' => gmdate('Y-m-d H:i:s'),
    ]);

    $mineLlm = oaao_mine_resolve_llm($this);

    $sqliteRel = isset($mine['sqlite_path']) && \is_string($mine['sqlite_path']) ? trim($mine['sqlite_path']) : '';
    if ($sqliteRel === '') {
        $sqliteRel = oaao_mine_relative_sqlite_path($ctx['tenant_id'], $mineId);
        $repo->updateMine($mineId, ['sqlite_path' => $sqliteRel]);
    }

    $payload = [
        'run_id'           => $runId,
        'mine'             => $mine,
        'sources'          => $sources,
        'user_id'          => $ctx['uid'],
        'tenant_id'        => $ctx['tenant_id'],
        'mine_llm'         => $mineLlm,
        'sqlite_root'      => oaao_mine_data_root(),
        'sqlite_path'      => $sqliteRel,
    ];

    $resp = ChatOrchestratorApi::postInternalJson('/v1/mine/run', $payload, 300);
    if ($resp === null) {
        $repo->updateRun($runId, [
            'status'      => 'failed',
            'error_text'  => 'orchestrator_unreachable',
            'finished_at' => gmdate('Y-m-d H:i:s'),
        ]);
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable']);

        return;
    }

    $stats = isset($resp['stats']) && \is_array($resp['stats']) ? $resp['stats'] : $resp;
    $failed = ! empty($resp['error']) || (isset($resp['ok']) && $resp['ok'] === false);
    try {
        $statsJson = json_encode($stats, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        $statsJson = null;
    }

    $repo->updateRun($runId, [
        'status'      => $failed ? 'failed' : 'done',
        'stats_json'  => $statsJson,
        'error_text'  => $failed ? (string) ($resp['error'] ?? 'worker_failed') : null,
        'finished_at' => gmdate('Y-m-d H:i:s'),
    ]);

    $minePatch = [
        'last_run_at' => gmdate('Y-m-d H:i:s'),
        'updated_at'  => gmdate('Y-m-d H:i:s'),
    ];
    $interval = isset($mine['interval_minutes']) && is_numeric($mine['interval_minutes'])
        ? (int) $mine['interval_minutes']
        : 0;
    if ($interval > 0 && (int) ($mine['is_enabled'] ?? 0) === 1) {
        $minePatch['next_run_at'] = oaao_mine_compute_next_run_at($interval);
    }
    if (! $failed && isset($resp['schema_json']) && \is_array($resp['schema_json'])) {
        try {
            $minePatch['schema_json'] = json_encode($resp['schema_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
        }
    }
    $repo->updateMine($mineId, $minePatch);

    if (! $failed) {
        $this->oaao_mine_maybe_notify($ctx['pdo'], $ctx['uid'], $mineId, $runId, $mine, $stats);
    }

    echo json_encode([
        'success' => ! $failed,
        'run_id'  => $runId,
        'stats'   => $stats,
        'data'    => $resp,
    ], JSON_UNESCAPED_UNICODE);
};
