<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\corpus\CorpusLlmBootstrap;
use oaaoai\corpus\CorpusRepository;

/**
 * POST /corpus/api/corpus_profile_render — enqueue HTML/PDF render (CS-1-S13).
 * Poll GET corpus_job_poll?job_id= . Heavy render runs in Python only.
 *
 * Body: corpus_id, format (html|pdf), parameters? (object), workspace_id?
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
    $format = strtolower(trim((string) ($input['format'] ?? 'html')));
    if ($corpusId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id required']);

        return;
    }
    if (! \in_array($format, ['html', 'pdf'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'format must be html or pdf']);

        return;
    }

    $brief = trim((string) ($input['brief'] ?? ''));

    $parameters = [];
    if (isset($input['parameters']) && \is_array($input['parameters'])) {
        foreach ($input['parameters'] as $k => $v) {
            if (! \is_string($k) || $k === '') {
                continue;
            }
            $parameters[$k] = \is_scalar($v) ? (string) $v : '';
        }
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
        echo json_encode(['success' => false, 'message' => 'Corpus must be ready before render']);

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

    $meta = isset($style['meta']) && \is_array($style['meta']) ? $style['meta'] : [];
    $htmlTemplate = isset($meta['html_template']) && \is_array($meta['html_template'])
        ? $meta['html_template']
        : null;
    if ($htmlTemplate === null) {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'No HTML template — Re-analyze corpus to build print layout (CS-1-S12).',
        ]);

        return;
    }

    $jobId = 'crn-' . bin2hex(random_bytes(8));
    $payload = [
        'corpus_id'      => $corpusId,
        'profile_name'   => (string) ($profile['name'] ?? ''),
        'format'         => $format,
        'style_json'     => $style,
        'html_template'  => $htmlTemplate,
        'parameters'     => $parameters,
        'brief'          => $brief !== '' ? $brief : null,
        'background'     => true,
        'render_job_id'  => $jobId,
    ];
    if ($brief !== '') {
        $llmCfg = CorpusLlmBootstrap::llmCfgForPayload(CorpusLlmBootstrap::resolveStyleLlm($this));
        if ($llmCfg !== null) {
            $payload['llm_cfg'] = $llmCfg;
        }
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/corpus/render', $payload, 30);
    if ($resp === null) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => oaao_corpus_orchestrator_unreachable_message(),
        ]);

        return;
    }

    if (empty($resp['ok']) && ($resp['status'] ?? '') !== 'running') {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['detail'] ?? $resp['error'] ?? 'render_failed'),
            'data'    => [
                'format' => $format,
                'error'  => $resp['error'] ?? null,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $orchJob = isset($resp['job_id']) ? trim((string) $resp['job_id']) : '';
    if ($orchJob !== '') {
        $jobId = $orchJob;
    }

    if (($resp['status'] ?? '') !== 'running' && isset($resp['html'])) {
        echo json_encode([
            'success' => true,
            'data'    => [
                'corpus_id'  => $corpusId,
                'job_id'     => $jobId,
                'status'     => 'done',
                'format'     => $format,
                'html'       => (string) ($resp['html'] ?? ''),
                'error'      => isset($resp['error']) ? (string) $resp['error'] : null,
                'detail'     => isset($resp['detail']) ? (string) $resp['detail'] : null,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'corpus_id' => $corpusId,
            'job_id'    => $jobId,
            'status'    => 'running',
            'format'    => $format,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
