<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /corpus/api/corpus_job_poll?job_id= — poll orchestrator corpus job (analyze, generate, render).
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $jobId = trim((string) ($_GET['job_id'] ?? ''));
    if ($jobId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'job_id required']);

        return;
    }

    $job = ChatOrchestratorApi::getInternalJson('/v1/corpus/jobs/' . rawurlencode($jobId), 20);
    if ($job === null) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'Job not found (orchestrator may have restarted). Close the dialog and try again.',
            'data'    => [
                'job_id' => $jobId,
                'status' => 'lost',
            ],
        ]);

        return;
    }

    $status = (string) ($job['status'] ?? '');
    if ($status === 'failed' || ($job['ok'] ?? null) === false) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($job['detail'] ?? $job['error'] ?? 'job_failed'),
            'data'    => [
                'job_id' => $jobId,
                'status' => 'failed',
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    if ($status === 'running') {
        echo json_encode([
            'success' => true,
            'data'    => [
                'job_id' => $jobId,
                'status' => 'running',
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $done = [
        'job_id'     => $jobId,
        'status'     => 'done',
        'format'     => isset($job['format']) ? (string) $job['format'] : null,
        'markdown'   => (string) ($job['markdown'] ?? ''),
        'html'       => isset($job['html']) ? (string) $job['html'] : null,
        'brief'      => isset($job['brief']) ? (string) $job['brief'] : null,
        'similarity' => isset($job['similarity']) && \is_array($job['similarity']) ? $job['similarity'] : null,
        'segments'   => isset($job['segments']) && \is_array($job['segments']) ? $job['segments'] : null,
        'style_json' => isset($job['style_json']) ? $job['style_json'] : null,
        'error'          => isset($job['error']) ? (string) $job['error'] : null,
        'detail'         => isset($job['detail']) ? (string) $job['detail'] : null,
        'pdf_bytes_b64'  => isset($job['pdf_bytes_b64']) ? (string) $job['pdf_bytes_b64'] : null,
        'pdf_size_bytes' => isset($job['pdf_size_bytes']) ? (int) $job['pdf_size_bytes'] : null,
        'mime'           => isset($job['mime']) ? (string) $job['mime'] : null,
        'parameters'     => isset($job['parameters']) && \is_array($job['parameters']) ? $job['parameters'] : null,
    ];

    echo json_encode([
        'success' => true,
        'data'    => $done,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
