<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_job_reclaim_orphans — orchestrator startup: re-queue {@code running} jobs left by a dead worker.
 *
 * Single sidecar assumption: when the poll loop starts, no other process is actively finishing these rows.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! $this->oaao_vault_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $pdo = $this->oaao_vault_sidecar_require_pdo();
    if ($pdo === null) {
        return;
    }

    try {
        $st = $pdo->prepare(
            'UPDATE oaao_vault_job
             SET status = \'queued\',
                 claimed_at = NULL,
                 last_error = \'reclaimed_orphan_running\',
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = \'running\'
             RETURNING job_id',
        );
        $st->execute();
        /** @var list<int> $ids */
        $ids = [];
        while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (isset($row['job_id'])) {
                $ids[] = (int) $row['job_id'];
            }
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'reclaimed_job_ids' => $ids,
                'count'             => \count($ids),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Orphan reclaim failed',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
