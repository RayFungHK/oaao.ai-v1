<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_job_claim — orchestrator pulls next queued vault ingest job ({@code X-OAAO-Internal-Token}).
 *
 * Also re-claims {@code running} rows whose {@code claimed_at} is older than 15 minutes (worker crash / hung embed).
 * On sidecar startup, {@see vault_job_reclaim_orphans.php} re-queues all {@code running} jobs immediately.
 *
 * JSON body optional: {@code hook_id} filter.
 *
 * When {@code vh.rag.document_embed} is claimed, updates {@code oaao_vault_document.embed_status} to {@code embedding}
 * so the Vault UI survives full page reload (distinct from {@code pending} queue-only rows).
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

    $raw = file_get_contents('php://input');
    /** @var array<string, mixed> $body */
    $body = [];
    if (\is_string($raw) && trim($raw) !== '') {
        $dec = json_decode($raw, true);
        if (\is_array($dec)) {
            $body = $dec;
        }
    }

    $hookFilter = '';
    if (isset($body['hook_id']) && \is_string($body['hook_id'])) {
        $hookFilter = trim($body['hook_id']);
    }

    $pdo->beginTransaction();

    try {
        $sql = 'WITH picked AS (
            SELECT job_id FROM oaao_vault_job
            WHERE status = \'queued\'
               OR (
                    status = \'running\'
                    AND claimed_at IS NOT NULL
                    AND claimed_at < CURRENT_TIMESTAMP - INTERVAL \'15 minutes\'
               )';
        if ($hookFilter !== '') {
            $sql .= ' AND hook_id = :hook_id';
        }
        $sql .= ' ORDER BY
            CASE hook_id
                WHEN \'vh.rag.audio_asr\' THEN 0
                WHEN \'vh.rag.document_embed\' THEN 1
                WHEN \'vh.rag.transcript_summary\' THEN 2
                WHEN \'vh.rag.graph_index\' THEN 3
                ELSE 4
            END,
            CASE WHEN status = \'queued\' THEN 0 ELSE 1 END,
            created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE oaao_vault_job j
        SET status = \'running\',
            claimed_at = CURRENT_TIMESTAMP,
            attempts = j.attempts + 1,
            updated_at = CURRENT_TIMESTAMP
        FROM picked p
        WHERE j.job_id = p.job_id
        RETURNING j.*';

        $st = $pdo->prepare($sql);
        if ($hookFilter !== '') {
            $st->bindValue(':hook_id', $hookFilter, \PDO::PARAM_STR);
        }
        $st->execute();
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);

        if ($row !== false) {
            $claimedDocId = isset($row['document_id']) ? (int) $row['document_id'] : 0;
            $claimedHook = isset($row['hook_id']) ? trim((string) $row['hook_id']) : '';
            if ($claimedDocId > 0 && $claimedHook === 'vh.rag.document_embed') {
                /** Clear stale retry notes once work is actively running ({@see vault_job_finish} {@code queued} path). */
                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                        embed_status = \'embedding\',
                        embed_error = NULL,
                        last_job_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?
                       AND embed_status <> \'embedded\'',
                );
                $du->execute([$claimedDocId]);
            } elseif ($claimedDocId > 0 && $claimedHook === 'vh.rag.graph_index') {
                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                        graph_status = \'building\',
                        graph_error = NULL,
                        graph_started_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?',
                );
                $du->execute([$claimedDocId]);
            } elseif ($claimedDocId > 0 && $claimedHook === 'vh.rag.transcript_summary') {
                $selMeta = $pdo->prepare('SELECT meta_json FROM oaao_vault_document WHERE id = ? FOR UPDATE');
                $selMeta->execute([$claimedDocId]);
                /** @var array<string, mixed>|false $docMetaRow */
                $docMetaRow = $selMeta->fetch(\PDO::FETCH_ASSOC);
                if (\is_array($docMetaRow)) {
                    /** @var array<string, mixed> $metaRoot */
                    $metaRoot = [];
                    $rawMeta = $docMetaRow['meta_json'] ?? null;
                    if (\is_string($rawMeta) && trim($rawMeta) !== '') {
                        try {
                            $dec = json_decode(trim($rawMeta), true, 512, JSON_THROW_ON_ERROR);
                            if (\is_array($dec)) {
                                $metaRoot = $dec;
                            }
                        } catch (\JsonException) {
                            $metaRoot = [];
                        }
                    }
                    /** @var array<string, mixed> $ts */
                    $ts = \is_array($metaRoot['transcript_summary'] ?? null) ? $metaRoot['transcript_summary'] : [];
                    $ts['status'] = 'generating';
                    $metaRoot['transcript_summary'] = $ts;
                    $du = $pdo->prepare(
                        'UPDATE oaao_vault_document SET meta_json = ?, last_job_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    );
                    $du->execute([
                        json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                        $claimedDocId,
                    ]);
                }
            }
        }

        $pdo->commit();

        if ($row === false) {
            echo json_encode(['success' => true, 'data' => ['job' => null]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

            return;
        }

        $payload = null;
        $pj = isset($row['payload_json']) && \is_string($row['payload_json']) ? $row['payload_json'] : '';
        if ($pj !== '') {
            $payload = json_decode($pj, true);
            if (! \is_array($payload)) {
                $payload = ['raw_payload_json' => $pj];
            }
        }

        $absolutePath = null;
        if (\is_array($payload)) {
            $sr = isset($payload['storage_root']) ? rtrim((string) $payload['storage_root'], '/') : '';
            $rp = isset($payload['relative_path']) ? ltrim((string) $payload['relative_path'], '/') : '';
            if ($sr !== '' && $rp !== '') {
                $absolutePath = $sr . '/' . $rp;
            }
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'job' => [
                    'job_id'       => isset($row['job_id']) ? (int) $row['job_id'] : null,
                    'document_id'  => isset($row['document_id']) ? (int) $row['document_id'] : null,
                    'vault_id'     => isset($row['vault_id']) ? (int) $row['vault_id'] : null,
                    'workspace_id' => isset($row['workspace_id']) && $row['workspace_id'] !== null ? (int) $row['workspace_id'] : null,
                    'hook_id'      => isset($row['hook_id']) ? (string) $row['hook_id'] : '',
                    'status'       => isset($row['status']) ? (string) $row['status'] : '',
                    'attempts'     => isset($row['attempts']) ? (int) $row['attempts'] : 0,
                    'payload'      => $payload,
                    'absolute_path'=> $absolutePath,
                ],
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        $pdo->rollBack();

        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Job claim failed',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
