<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

/**
 * POST /research/api/fetch_job_claim — internal: claim next queued research fetch job.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    $pdo = $db?->getDBAdapter();
    if (! ($pdo instanceof \PDO)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    $input = json_decode((string) file_get_contents('php://input'), true);
    $watchId = \is_array($input) && isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    $runId = \is_array($input) && isset($input['run_id']) ? (int) $input['run_id'] : 0;

    $maxRunning = (int) (getenv('OAAO_RESEARCH_FETCH_MAX_CONCURRENT') ?: 4);
    $maxRunning = max(1, min(5, $maxRunning));

    $pdo->beginTransaction();

    try {
        $where = '(status = \'queued\' OR (status = \'running\' AND claimed_at IS NOT NULL AND claimed_at < CURRENT_TIMESTAMP - INTERVAL \'15 minutes\'))';
        $where .= ' AND (SELECT COUNT(*)::int FROM oaao_research_fetch_job WHERE status = \'running\') < :max_running';
        if ($watchId > 0) {
            $where .= ' AND watch_id = :watch_id';
        }
        if ($runId > 0) {
            $where .= ' AND run_id = :run_id';
        }

        $sql = "WITH picked AS (
            SELECT job_id FROM oaao_research_fetch_job
            WHERE {$where}
            ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END, sort_order ASC, created_at ASC
            LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE oaao_research_fetch_job j
        SET status = 'running',
            claimed_at = CURRENT_TIMESTAMP,
            started_at = COALESCE(j.started_at, CURRENT_TIMESTAMP)
        FROM picked p
        INNER JOIN oaao_research_watch w ON w.watch_id = (
            SELECT fj.watch_id FROM oaao_research_fetch_job fj WHERE fj.job_id = p.job_id
        )
        WHERE j.job_id = p.job_id
        RETURNING j.*, w.vault_id AS watch_vault_id, w.container_id AS watch_container_id,
                  w.workspace_id AS watch_workspace_id, w.summary_language AS watch_summary_language,
                  w.owner_user_id AS watch_owner_user_id, w.config_json AS watch_config_json";

        $st = $pdo->prepare($sql);
        $st->bindValue(':max_running', $maxRunning, \PDO::PARAM_INT);
        if ($watchId > 0) {
            $st->bindValue(':watch_id', $watchId, \PDO::PARAM_INT);
        }
        if ($runId > 0) {
            $st->bindValue(':run_id', $runId, \PDO::PARAM_INT);
        }
        $st->execute();
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);
        $pdo->commit();

        if ($row === false) {
            echo json_encode(['success' => true, 'job' => null], JSON_UNESCAPED_UNICODE);

            return;
        }

        echo json_encode(['success' => true, 'job' => $row], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not claim fetch job',
            'data'    => ['detail' => $e->getMessage()],
        ], JSON_UNESCAPED_UNICODE);
    }
};
