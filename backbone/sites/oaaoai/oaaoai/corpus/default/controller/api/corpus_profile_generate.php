<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\corpus\CorpusLlmBootstrap;
use oaaoai\corpus\CorpusRepository;

/**
 * POST /corpus/api/corpus_profile_generate — enqueue brief + ready profile → sample markdown (CS-1-S9).
 * Poll with GET corpus_job_poll?job_id= (background LLM; does not block PHP-FPM).
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $scopeWid = oaao_corpus_resolve_workspace_scope(
        $this,
        $ctx,
        oaao_corpus_workspace_from_request($input),
    );
    if ($scopeWid === false) {
        return;
    }

    $corpusId = (int) ($input['corpus_id'] ?? 0);
    $brief = trim((string) ($input['brief'] ?? ''));
    if ($corpusId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id required']);

        return;
    }
    if ($brief === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'brief required']);

        return;
    }
    if (mb_strlen($brief) > 4000) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'brief too long']);

        return;
    }

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    if ((string) ($profile['status'] ?? '') !== 'ready') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'Corpus must be ready before generating a preview']);

        return;
    }

    $style = CorpusRepository::decodeStyleJson(
        isset($profile['style_json']) ? (string) $profile['style_json'] : null,
    );
    if ($style === null) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'No style profile — run Analyze first']);

        return;
    }

    $segCount = $repo->countSegments($corpusId);
    if ($segCount < 1) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'No segments — run Analyze first']);

        return;
    }

    $sampleSegments = [];
    foreach ($repo->listSegments($corpusId, 24) as $seg) {
        if (! \is_array($seg)) {
            continue;
        }
        $cj = null;
        if (isset($seg['classify_json']) && \is_string($seg['classify_json']) && $seg['classify_json'] !== '') {
            try {
                $cj = json_decode($seg['classify_json'], true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $cj = null;
            }
        }
        $sampleSegments[] = [
            'text'          => (string) ($seg['text'] ?? ''),
            'classify_json' => $cj,
            'ordinal'       => (int) ($seg['ordinal'] ?? 0),
        ];
    }

    $jobId = 'cgn-' . bin2hex(random_bytes(8));
    $payload = [
        'corpus_id'        => $corpusId,
        'profile_name'     => (string) ($profile['name'] ?? ''),
        'brief'            => $brief,
        'style_json'       => $style,
        'sample_segments'  => $sampleSegments,
        'background'       => true,
        'generate_job_id'  => $jobId,
    ];
    $llmCfg = CorpusLlmBootstrap::llmCfgForPayload(CorpusLlmBootstrap::resolveStyleLlm($this));
    if ($llmCfg === null || trim((string) ($llmCfg['base_url'] ?? '')) === '') {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'No LLM endpoint for Corpus — configure Corpus or Planning binding in Settings → Endpoints.',
        ]);

        return;
    }
    $payload['llm_cfg'] = $llmCfg;

    $resp = ChatOrchestratorApi::postInternalJson('/v1/corpus/generate', $payload, 30);
    if ($resp === null) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => oaao_corpus_orchestrator_unreachable_message(),
        ]);

        return;
    }

    if (empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['detail'] ?? $resp['error'] ?? 'generate_failed'),
        ]);

        return;
    }

    $orchJob = isset($resp['job_id']) ? trim((string) $resp['job_id']) : '';
    if ($orchJob !== '') {
        $jobId = $orchJob;
    }

    if (($resp['status'] ?? '') !== 'running' && isset($resp['markdown'])) {
        $similarity = isset($resp['similarity']) && \is_array($resp['similarity']) ? $resp['similarity'] : null;
        echo json_encode([
            'success' => true,
            'data'    => [
                'corpus_id'  => $corpusId,
                'brief'      => $brief,
                'job_id'     => $jobId,
                'status'     => 'done',
                'markdown'   => (string) ($resp['markdown'] ?? ''),
                'similarity' => $similarity,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'corpus_id' => $corpusId,
            'brief'     => $brief,
            'job_id'    => $jobId,
            'status'    => 'running',
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
