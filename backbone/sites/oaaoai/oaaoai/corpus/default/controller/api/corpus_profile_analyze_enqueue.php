<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\corpus\CorpusAnalyzeApply;
use oaaoai\corpus\CorpusAnalyzePayload;
use oaaoai\corpus\CorpusLlmBootstrap;
use oaaoai\corpus\CorpusRepository;

/**
 * POST /corpus/api/corpus_profile_analyze_enqueue — body { corpus_id, workspace_id? }
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
    if ($corpusId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id required']);

        return;
    }

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    if ($repo->countSources($corpusId) < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Add at least one source before analyzing']);

        return;
    }

    $status = (string) ($profile['status'] ?? 'draft');
    if ($status === 'learning') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'Analysis already in progress']);

        return;
    }

    $builder = new CorpusAnalyzePayload($ctx['db'], $ctx['pdo'], $repo);
    $jobId = 'can-' . bin2hex(random_bytes(8));
    $llmCfg = CorpusLlmBootstrap::llmCfgForPayload(CorpusLlmBootstrap::resolveStyleLlm($this));
    $payload = $builder->build($corpusId, $ctx['tenant_id'], $ctx['uid'], $profile, $llmCfg);
    $payload['analyze_job_id'] = $jobId;

    if ($payload['sources'] === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'No readable sources found for analysis']);

        return;
    }

    $now = gmdate('Y-m-d H:i:s');
    $repo->patchProfileAnalyze($corpusId, [
        'status'             => 'learning',
        'error_message'      => null,
        'analyze_job_id'     => $jobId,
        'analyze_started_at' => $now,
        'updated_at'         => $now,
    ]);

    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;
    if ((string) ($profile['status'] ?? '') !== 'learning') {
        error_log(
            'oaaoai/corpus analyze_enqueue: status not learning after patch corpus_id='
            . $corpusId
            . ' got='
            . (string) ($profile['status'] ?? ''),
        );
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not mark corpus as analyzing (database update did not apply)',
        ]);

        return;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/corpus/analyze', $payload, 30);
    if ($resp === null) {
        $unreach = oaao_corpus_orchestrator_unreachable_message();
        $repo->patchProfileAnalyze($corpusId, [
            'status'        => 'error',
            'error_message' => $unreach,
            'updated_at'    => gmdate('Y-m-d H:i:s'),
        ]);
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => $unreach]);

        return;
    }

    $orchJob = isset($resp['job_id']) ? trim((string) $resp['job_id']) : '';
    if ($orchJob !== '') {
        $jobId = $orchJob;
        $repo->patchProfileAnalyze($corpusId, ['analyze_job_id' => $jobId]);
    }

    if (! empty($resp['ok']) && ($resp['status'] ?? '') !== 'running' && isset($resp['segments'])) {
        CorpusAnalyzeApply::fromOrchestratorResponse($repo, $corpusId, $resp);
    }

    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;

    echo json_encode([
        'success' => true,
        'data'    => [
            'corpus_id'      => $corpusId,
            'job_id'         => $jobId,
            'status'         => (string) ($profile['status'] ?? $resp['status'] ?? 'running'),
            'segment_count'  => $repo->countSegments($corpusId),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
