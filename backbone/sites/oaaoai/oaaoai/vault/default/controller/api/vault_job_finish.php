<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_job_finish — orchestrator reports completion ({@code X-OAAO-Internal-Token}).
 *
 * JSON body: {@code job_id} (int), {@code status} {@code completed}|{@code failed}|{@code queued} (retry), optional {@code error}.
 *
 * - {@code queued} on ingest/graph hooks → persists {@code embed_error}/{@code graph_error} (fallback snippet when JSON {@code error} omitted). Document / graph terminal states are **not** downgraded (e.g. {@code embedding} stays {@code embedding} while the job row returns to queued for another claim).
 *
 * **Document row ({@code oaao_vault_document.embed_status})** — legacy ingest parity:
 * - {@code failed} on {@code vh.rag.document_embed} / {@code vh.rag.audio_asr} → {@code embed_status = failed}, bump {@code embed_attempts}.
 * - {@code failed} on {@code vh.rag.graph_index} → {@code graph_status = failed}, {@code graph_error}.
 * - {@code completed} + hook {@code vh.rag.document_embed} → {@code embedded}, {@code embedded_at}; may enqueue {@code vh.rag.graph_index} when vault {@code graph_mode} is on.
 * - {@code completed} + hook {@code vh.rag.graph_index} → {@code graph_status = indexed}, {@code graph_finished_at}.
 * - {@code completed} + hook {@code vh.rag.audio_asr} → touch {@code last_job_at} only (transcript/embed follow-up may enqueue another job).
 * - Other completed hooks (e.g. rerank) → no automatic {@code embed_status} change.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! $this->oaao_vault_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $ctx = $this->oaao_vault_sidecar_pg_context();
    if ($ctx === null) {
        return;
    }
    $pdo = $ctx['pdo'];
    $db = $ctx['db'];

    $raw = file_get_contents('php://input');
    /** @var array<string, mixed> $body */
    $body = [];
    if (\is_string($raw) && trim($raw) !== '') {
        $dec = json_decode($raw, true);
        if (\is_array($dec)) {
            $body = $dec;
        }
    }

    $jobId = isset($body['job_id']) && is_numeric($body['job_id']) ? (int) $body['job_id'] : 0;
    $statusIn = isset($body['status']) && \is_string($body['status']) ? trim($body['status']) : '';

    if ($jobId < 1 || ! \in_array($statusIn, ['completed', 'failed', 'queued'], true)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'job_id and status (completed|failed|queued) required',
        ]);

        return;
    }

    $errMsg = isset($body['error']) ? trim((string) $body['error']) : '';

    /** @var array{doc_id: int, vault_id: int}|null */
    $deferGraphIndex = null;
    /** @var array{doc_id: int, vault_id: int, wid: ?int, source_text: string}|null */
    $deferEmbedAfterAsr = null;
    /** @var array{doc_id: int, vault_id: int, wid: ?int, source_text: string, summary_text: string, summary_label: string, summary_meta: array<string, mixed>}|null */
    $deferEmbedAfterSummary = null;
    /** @var array{tid: int, hook_id: string, status: string, body: array<string, mixed>, job: array<string, mixed>}|null */
    $deferUsage = null;

    $pdo->beginTransaction();

    try {
        $sel = $pdo->prepare('SELECT * FROM oaao_vault_job WHERE job_id = ? FOR UPDATE');
        $sel->execute([$jobId]);
        /** @var array<string, mixed>|false $job */
        $job = $sel->fetch(\PDO::FETCH_ASSOC);
        if ($job === false) {
            $pdo->rollBack();
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Unknown job']);

            return;
        }

        $lastErr = null;
        if ($statusIn === 'failed') {
            $lastErr = $errMsg !== '' ? $errMsg : 'failed';
        } elseif ($statusIn === 'queued' && $errMsg !== '') {
            $lastErr = $errMsg;
        }

        if ($statusIn === 'queued') {
            $up = $pdo->prepare(
                'UPDATE oaao_vault_job SET
                    status = ?,
                    finished_at = NULL,
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE job_id = ?',
            );
            $up->execute([$statusIn, $lastErr, $jobId]);
        } else {
            $up = $pdo->prepare(
                'UPDATE oaao_vault_job SET
                    status = ?,
                    finished_at = CURRENT_TIMESTAMP,
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE job_id = ?',
            );
            $up->execute([$statusIn, $lastErr, $jobId]);
        }

        $docId = isset($job['document_id']) ? (int) $job['document_id'] : 0;
        $hookId = isset($job['hook_id']) ? trim((string) $job['hook_id']) : '';
        $isDocumentEmbed = ($hookId === 'vh.rag.document_embed');
        $isAudioAsr = ($hookId === 'vh.rag.audio_asr');
        $isGraphIndex = ($hookId === 'vh.rag.graph_index');
        $isTranscriptSummary = ($hookId === 'vh.rag.transcript_summary');
        $vaultId = isset($job['vault_id']) ? (int) $job['vault_id'] : 0;

        if ($docId > 0) {
            if ($statusIn === 'failed') {
                if ($isTranscriptSummary) {
                    $errNote = $lastErr ?? 'failed';
                    $selMeta = $pdo->prepare('SELECT meta_json FROM oaao_vault_document WHERE id = ? FOR UPDATE');
                    $selMeta->execute([$docId]);
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
                        $ts['status'] = 'failed';
                        $ts['error'] = substr((string) $errNote, 0, 4000);
                        $metaRoot['transcript_summary'] = $ts;
                        $du = $pdo->prepare(
                            'UPDATE oaao_vault_document SET meta_json = ?, last_job_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        );
                        $du->execute([
                            json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                            $docId,
                        ]);
                    }
                } elseif ($isDocumentEmbed || $isAudioAsr) {
                    $du = $pdo->prepare(
                        'UPDATE oaao_vault_document SET
                            embed_status = \'failed\',
                            embed_error = ?,
                            embed_attempts = embed_attempts + 1,
                            last_job_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?',
                    );
                    $du->execute([$lastErr ?? 'failed', $docId]);
                } elseif ($isGraphIndex) {
                    $du = $pdo->prepare(
                        'UPDATE oaao_vault_document SET
                            graph_status = \'failed\',
                            graph_error = ?,
                            graph_finished_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?',
                    );
                    $du->execute([$lastErr ?? 'failed', $docId]);
                }
            } elseif ($statusIn === 'completed' && $isDocumentEmbed) {
                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                        embed_status = \'embedded\',
                        embed_error = NULL,
                        embedded_at = CURRENT_TIMESTAMP,
                        last_job_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?',
                );
                $du->execute([$docId]);
                $deferGraphIndex = ['doc_id' => $docId, 'vault_id' => $vaultId];
            } elseif ($statusIn === 'completed' && $isGraphIndex) {
                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                        graph_status = \'indexed\',
                        graph_error = NULL,
                        graph_finished_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?',
                );
                $du->execute([$docId]);
            } elseif ($statusIn === 'completed' && $isAudioAsr) {
                $sourceText = isset($body['source_text']) ? trim((string) $body['source_text']) : '';
                $metaPatch = $body['meta_json'] ?? null;
                $metaStr = null;
                if (\is_array($metaPatch)) {
                    try {
                        $metaStr = json_encode($metaPatch, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    } catch (\JsonException) {
                        $metaStr = null;
                    }
                } elseif (\is_string($metaPatch) && trim($metaPatch) !== '') {
                    $metaStr = trim($metaPatch);
                }

                if ($sourceText !== '') {
                    if ($metaStr !== null) {
                        $du = $pdo->prepare(
                            'UPDATE oaao_vault_document SET
                                source_text = ?,
                                meta_json = ?,
                                last_job_at = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?',
                        );
                        $du->execute([substr($sourceText, 0, 500000), $metaStr, $docId]);
                    } else {
                        $du = $pdo->prepare(
                            'UPDATE oaao_vault_document SET
                                source_text = ?,
                                last_job_at = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?',
                        );
                        $du->execute([substr($sourceText, 0, 500000), $docId]);
                    }
                } else {
                    $du = $pdo->prepare(
                        'UPDATE oaao_vault_document SET
                            last_job_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?',
                    );
                    $du->execute([$docId]);
                }

                $enqueueEmbed = ! empty($body['enqueue_document_embed']);
                if ($enqueueEmbed && $sourceText !== '' && $vaultId > 0) {
                    $widRaw = isset($job['workspace_id']) ? (int) $job['workspace_id'] : 0;
                    $widJob = $widRaw > 0 ? $widRaw : null;
                    $deferEmbedAfterAsr = [
                        'doc_id'       => $docId,
                        'vault_id'     => $vaultId,
                        'wid'          => $widJob,
                        'source_text'  => $sourceText,
                    ];
                }
            } elseif ($statusIn === 'completed' && $isTranscriptSummary) {
                $tsPayload = $body['transcript_summary'] ?? null;
                $summaryText = '';
                if (\is_array($tsPayload) && isset($tsPayload['text']) && \is_string($tsPayload['text'])) {
                    $summaryText = trim($tsPayload['text']);
                }
                $sourceText = isset($body['source_text']) ? trim((string) $body['source_text']) : '';

                $selMeta = $pdo->prepare('SELECT meta_json FROM oaao_vault_document WHERE id = ? FOR UPDATE');
                $selMeta->execute([$docId]);
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
                    $finishedAt = date('Y-m-d H:i:s');
                    /** @var array<string, mixed> $merged */
                    $merged = \is_array($metaRoot['transcript_summary'] ?? null) ? $metaRoot['transcript_summary'] : [];
                    if (\is_array($tsPayload)) {
                        foreach ($tsPayload as $k => $v) {
                            if ($v !== null && $v !== '') {
                                $merged[(string) $k] = $v;
                            }
                        }
                    }
                    $merged['status'] = 'completed';
                    $merged['text'] = $summaryText;
                    $merged['generated_at'] = $finishedAt;
                    unset($merged['error'], $merged['queued_at']);
                    $metaRoot['transcript_summary'] = $merged;
                    $du = $pdo->prepare(
                        'UPDATE oaao_vault_document SET meta_json = ?, last_job_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    );
                    $du->execute([
                        json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                        $docId,
                    ]);
                }

                $enqueueEmbed = ! empty($body['enqueue_document_embed']);
                if ($enqueueEmbed && $summaryText !== '' && $sourceText !== '' && $vaultId > 0) {
                    $widRaw = isset($job['workspace_id']) ? (int) $job['workspace_id'] : 0;
                    $widJob = $widRaw > 0 ? $widRaw : null;
                    $label = '';
                    if (\is_array($tsPayload)) {
                        $label = trim((string) ($tsPayload['template_emoji'] ?? '') . ' ' . (string) ($tsPayload['template_label'] ?? 'Summary'));
                    }
                    /** @var array<string, mixed> $summaryMeta */
                    $summaryMeta = \is_array($tsPayload) ? $tsPayload : [];
                    $deferEmbedAfterSummary = [
                        'doc_id'        => $docId,
                        'vault_id'      => $vaultId,
                        'wid'           => $widJob,
                        'source_text'   => $sourceText,
                        'summary_text'  => $summaryText,
                        'summary_label' => $label !== '' ? $label : 'Summary',
                        'summary_meta'  => [
                            'template_id'      => (string) ($summaryMeta['template_id'] ?? ''),
                            'summary_language' => (string) ($summaryMeta['summary_language'] ?? ''),
                            'generated_at'     => date('Y-m-d H:i:s'),
                        ],
                    ];
                }
            } elseif ($statusIn === 'queued' && $docId > 0 && ($isDocumentEmbed || $isAudioAsr)) {
                /** Always persist a row note (claim clears stale text when work runs again; {@see vault_job_claim}). */
                $embNote = '';
                if ($lastErr !== null && trim((string) $lastErr) !== '') {
                    $embNote = substr(trim((string) $lastErr), 0, 4000);
                }
                if ($embNote === '') {
                    $embNote = 'job_requeued_no_detail';
                }

                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                            embed_error = ?,
                            last_job_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?
                           AND embed_status <> \'embedded\'',
                );
                $du->execute([$embNote, $docId]);
            } elseif ($statusIn === 'queued' && $isGraphIndex) {
                $gNote = '';
                if ($lastErr !== null && trim((string) $lastErr) !== '') {
                    $gNote = substr(trim((string) $lastErr), 0, 4000);
                }
                if ($gNote === '') {
                    $gNote = 'graph_job_requeued_no_detail';
                }

                $du = $pdo->prepare(
                    'UPDATE oaao_vault_document SET
                            graph_error = ?,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?',
                );
                $du->execute([$gNote, $docId]);
            }
        }

        $tid = isset($ctx['tid']) ? (int) $ctx['tid'] : 0;
        if ($statusIn === 'completed' && $tid > 0) {
            $deferUsage = [
                'tid'     => $tid,
                'hook_id' => $hookId,
                'status'  => $statusIn,
                'body'    => $body,
                'job'     => $job,
            ];
        }

        $pdo->commit();

        if ($deferGraphIndex !== null) {
            try {
                $this->oaao_vault_enqueue_graph_index_if_enabled(
                    $db,
                    $deferGraphIndex['doc_id'],
                    $deferGraphIndex['vault_id'],
                );
            } catch (\Throwable $e) {
                error_log('oaaoai/vault_job_finish graph_index enqueue: ' . $e->getMessage());
            }
        }
        if ($deferEmbedAfterAsr !== null) {
            try {
                $this->oaao_vault_enqueue_document_embed_after_asr(
                    $db,
                    $deferEmbedAfterAsr['doc_id'],
                    $deferEmbedAfterAsr['vault_id'],
                    $deferEmbedAfterAsr['wid'],
                    $deferEmbedAfterAsr['source_text'],
                );
            } catch (\Throwable $e) {
                error_log('oaaoai/vault_job_finish embed-after-asr enqueue: ' . $e->getMessage());
            }
        }
        if ($deferEmbedAfterSummary !== null) {
            try {
                $repo = new \oaaoai\endpoints\CanonicalEndpointsRepository($db);
                $embBind = $repo->resolveVaultIngestEmbeddingBinding();
                if ($embBind === null) {
                    throw new \RuntimeException('embedding purpose not configured');
                }
                $embedExtras = [
                    'embed_summary_text'  => substr($deferEmbedAfterSummary['summary_text'], 0, 120000),
                    'embed_summary_label' => substr($deferEmbedAfterSummary['summary_label'], 0, 240),
                    'embed_summary_meta'  => $deferEmbedAfterSummary['summary_meta'],
                ];
                $embedQueued = $this->oaao_vault_enqueue_document_embed_job(
                    $db,
                    $deferEmbedAfterSummary['doc_id'],
                    $deferEmbedAfterSummary['vault_id'],
                    $deferEmbedAfterSummary['wid'],
                    $deferEmbedAfterSummary['source_text'],
                    $embedExtras,
                    true,
                );
                if ($embedQueued) {
                    $ts = date('Y-m-d H:i:s');
                    /** @var array<string, mixed>|false $docRow */
                    $docRow = $db->prepare()
                        ->select('meta_json')
                        ->from('vault_document')
                        ->where('id=:id')
                        ->assign(['id' => $deferEmbedAfterSummary['doc_id']])
                        ->limit(1)
                        ->query()
                        ->fetch();
                    if (\is_array($docRow)) {
                        /** @var array<string, mixed> $metaRoot */
                        $metaRoot = [];
                        $rawMeta = $docRow['meta_json'] ?? null;
                        if (\is_string($rawMeta) && trim($rawMeta) !== '') {
                            $dec = json_decode(trim($rawMeta), true);
                            if (\is_array($dec)) {
                                $metaRoot = $dec;
                            }
                        }
                        if (\is_array($metaRoot['transcript_summary'] ?? null)) {
                            $metaRoot['transcript_summary']['embed_queued_at'] = $ts;
                            unset($metaRoot['transcript_summary']['embed_error']);
                            $db->update('vault_document', ['meta_json', 'updated_at'])
                                ->where('id=:id')
                                ->assign([
                                    'meta_json'  => json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                                    'updated_at' => $ts,
                                    'id'         => $deferEmbedAfterSummary['doc_id'],
                                ])
                                ->query();
                        }
                    }
                }
            } catch (\Throwable $e) {
                error_log('oaaoai/vault_job_finish embed-after-summary enqueue: ' . $e->getMessage());
            }
        }
        if ($deferUsage !== null) {
            try {
                require_once dirname(__DIR__, 4) . '/core/default/library/UsageEventRepository.php';
                \Oaaoai\Core\UsageEventRepository::recordVaultJobFinish(
                    $pdo,
                    $deferUsage['tid'],
                    $deferUsage['hook_id'],
                    $deferUsage['status'],
                    $deferUsage['body'],
                    $deferUsage['job'],
                );
            } catch (\Throwable $e) {
                error_log('oaaoai/vault_job_finish usage record: ' . $e->getMessage());
            }
        }

        echo json_encode(['success' => true, 'data' => ['job_id' => $jobId, 'status' => $statusIn]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        $pdo->rollBack();

        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Job finish failed',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
