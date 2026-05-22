<?php

declare(strict_types=1);

/**
 * POST /vault/api/document_enqueue — queue one or more ingest jobs for an existing document.
 *
 * JSON body: {@code document_id} (int), {@code hook_ids} (list of strings) or single {@code hook_id}, optional {@code workspace_id}, optional {@code force_reembed} (bool) to cancel stuck {@code embedding} jobs and queue a fresh embed run, optional {@code force_re_asr} (bool) to replace an existing audio transcript and re-run {@code vh.rag.audio_asr}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $docId = isset($body['document_id']) ? (int) $body['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    /** @var list<string> $hookIds */
    $hookIds = [];
    if (isset($body['hook_ids']) && \is_array($body['hook_ids'])) {
        foreach ($body['hook_ids'] as $h) {
            $hookIds[] = (string) $h;
        }
    } elseif (isset($body['hook_id'])) {
        $hookIds[] = (string) $body['hook_id'];
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    $forceReembed = isset($body['force_reembed']) && (
        $body['force_reembed'] === true
        || $body['force_reembed'] === 1
        || (is_string($body['force_reembed']) && in_array(strtolower(trim($body['force_reembed'])), ['1', 'true', 'yes'], true))
    );

    $forceReAsr = isset($body['force_re_asr']) && (
        $body['force_re_asr'] === true
        || $body['force_re_asr'] === 1
        || (is_string($body['force_re_asr']) && in_array(strtolower(trim($body['force_re_asr'])), ['1', 'true', 'yes'], true))
    );

    try {
        $jobs = $this->oaao_vault_enqueue_jobs_for_document($db, $uid, $wid, $docId, $hookIds, $forceReembed, $forceReAsr);
        if ($jobs === []) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'No hook ids provided']);

            return;
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id' => $docId,
                'jobs_queued' => $jobs,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\RuntimeException $e) {
        $msg = $e->getMessage();
        $code = str_starts_with($msg, 'Forbidden') ? 403 : 400;
        http_response_code($code);
        echo json_encode(['success' => false, 'message' => $msg]);
    }
};
