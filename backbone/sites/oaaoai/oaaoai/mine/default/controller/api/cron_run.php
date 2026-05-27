<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /mine/api/cron_run — run all due mines (internal token or authenticated owner batch).
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    $internal = \is_string($hdr) && $hdr !== '' && hash_equals($secret, $hdr);

    $repo = new MineRepository($ctx['db']);
    $due = $repo->listDueMines(20);
    if ($due === []) {
        echo json_encode(['success' => true, 'ran' => 0, 'results' => []], JSON_UNESCAPED_UNICODE);

        return;
    }

    $results = [];
    $ran = 0;
    foreach ($due as $mine) {
        if (! \is_array($mine)) {
            continue;
        }
        $mineId = (int) ($mine['mine_id'] ?? 0);
        $ownerId = (int) ($mine['owner_user_id'] ?? 0);
        if ($mineId < 1) {
            continue;
        }
        if (! $internal && $ownerId !== $ctx['uid']) {
            continue;
        }

        $_POST = [];
        $GLOBALS['HTTP_RAW_POST_DATA'] = json_encode(['mine_id' => $mineId]);
        // Re-use run_now logic inline via orchestrator call (same as run_now.php body).
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
            $sqliteRel = oaao_mine_relative_sqlite_path((int) ($mine['tenant_id'] ?? 1), $mineId);
            $repo->updateMine($mineId, ['sqlite_path' => $sqliteRel]);
        }

        $payload = [
            'run_id'      => $runId,
            'mine'        => $mine,
            'sources'     => $sources,
            'user_id'     => $ownerId > 0 ? $ownerId : $ctx['uid'],
            'tenant_id'   => (int) ($mine['tenant_id'] ?? $ctx['tenant_id']),
            'mine_llm'    => $mineLlm,
            'sqlite_root' => oaao_mine_data_root(),
            'sqlite_path' => $sqliteRel,
        ];

        $resp = ChatOrchestratorApi::postInternalJson('/v1/mine/run', $payload, 300);
        $failed = $resp === null || ! empty($resp['error']) || (isset($resp['ok']) && $resp['ok'] === false);
        $stats = isset($resp['stats']) && \is_array($resp['stats']) ? $resp['stats'] : ($resp ?? []);
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

        $interval = isset($mine['interval_minutes']) && is_numeric($mine['interval_minutes'])
            ? (int) $mine['interval_minutes']
            : 0;
        $minePatch = [
            'last_run_at' => gmdate('Y-m-d H:i:s'),
            'updated_at'  => gmdate('Y-m-d H:i:s'),
        ];
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
            require_once dirname(__DIR__, 2) . '/library/MineBlobSync.php';
            $sqliteRel = isset($mine['sqlite_path']) && \is_string($mine['sqlite_path']) ? trim($mine['sqlite_path']) : '';
            if ($sqliteRel !== '') {
                \oaaoai\mine\MineBlobSync::flushSqlite($ctx['pdo'], (int) $ctx['tenant_id'], $mineId, $sqliteRel);
            }
        }

        if (! $failed && $ownerId > 0) {
            $this->oaao_mine_maybe_notify($ctx['pdo'], $ownerId, $mineId, $runId, $mine, $stats);
        }

        $results[] = ['mine_id' => $mineId, 'run_id' => $runId, 'success' => ! $failed];
        $ran++;
    }

    echo json_encode(['success' => true, 'ran' => $ran, 'results' => $results], JSON_UNESCAPED_UNICODE);
};
