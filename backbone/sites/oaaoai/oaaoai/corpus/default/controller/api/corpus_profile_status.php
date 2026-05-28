<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\corpus\CorpusAnalyzeApply;
use oaaoai\corpus\CorpusRepository;

/**
 * GET /corpus/api/corpus_profile_status?corpus_id=&workspace_id=
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = $_GET;
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

    $status = (string) ($profile['status'] ?? 'draft');
    $jobId = isset($profile['analyze_job_id']) ? trim((string) $profile['analyze_job_id']) : '';

    if ($status === 'learning' && $jobId !== '') {
        $job = ChatOrchestratorApi::getInternalJson('/v1/corpus/jobs/' . rawurlencode($jobId), 15);
        if (\is_array($job)) {
            $jobStatus = (string) ($job['status'] ?? '');
            if ($jobStatus === 'done') {
                CorpusAnalyzeApply::fromOrchestratorResponse($repo, $corpusId, $job);
                $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;
                $status = (string) ($profile['status'] ?? $status);
            } elseif ($jobStatus === 'failed') {
                $repo->patchProfileAnalyze($corpusId, [
                    'status'        => 'error',
                    'error_message' => (string) ($job['detail'] ?? $job['error'] ?? 'analyze_failed'),
                    'updated_at'    => gmdate('Y-m-d H:i:s'),
                ]);
                $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;
                $status = 'error';
            }
        } elseif ($repo->countSegments($corpusId) > 0) {
            $repo->patchProfileAnalyze($corpusId, [
                'status'        => 'ready',
                'error_message' => null,
                'updated_at'    => gmdate('Y-m-d H:i:s'),
            ]);
            $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;
            $status = 'ready';
        } else {
            $startedRaw = $profile['analyze_started_at'] ?? null;
            $startedAt = \is_string($startedRaw) && $startedRaw !== '' ? strtotime($startedRaw) : false;
            if ($startedAt !== false && time() - $startedAt > 120) {
                $repo->patchProfileAnalyze($corpusId, [
                    'status'        => 'error',
                    'error_message' => 'Analysis job lost (orchestrator may have restarted). Run Analyze again.',
                    'updated_at'    => gmdate('Y-m-d H:i:s'),
                ]);
                $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid) ?? $profile;
                $status = 'error';
            }
        }
    }

    $segments = $repo->listSegments($corpusId, 12);
    $preview = [];
    foreach ($segments as $seg) {
        if (! \is_array($seg)) {
            continue;
        }
        $text = (string) ($seg['text'] ?? '');
        if (mb_strlen($text) > 240) {
            $text = mb_substr($text, 0, 240) . '…';
        }
        $classify = null;
        if (isset($seg['classify_json']) && \is_string($seg['classify_json']) && $seg['classify_json'] !== '') {
            try {
                $classify = json_decode($seg['classify_json'], true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $classify = null;
            }
        }
        $preview[] = [
            'segment_id'    => (int) ($seg['segment_id'] ?? 0),
            'text'          => $text,
            'ordinal'       => (int) ($seg['ordinal'] ?? 0),
            'classify_json' => $classify,
        ];
    }

    $style = null;
    if (isset($profile['style_json']) && \is_string($profile['style_json']) && $profile['style_json'] !== '') {
        try {
            $style = json_decode($profile['style_json'], true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $style = null;
        }
    }

    $segmentKindSummary = $repo->summarizeSegmentKinds($corpusId);
    $sourceWarnings = [];
    if (\is_array($style) && isset($style['meta']['source_structure_warnings'])
        && \is_array($style['meta']['source_structure_warnings'])) {
        $sourceWarnings = $style['meta']['source_structure_warnings'];
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'profile'                => CorpusRepository::profileForApi(
                $profile,
                $repo->countSources($corpusId),
                $repo->countSegments($corpusId),
            ),
            'source_count'           => $repo->countSources($corpusId),
            'segment_count'          => $repo->countSegments($corpusId),
            'segment_kind_summary'   => $segmentKindSummary,
            'source_structure_warnings' => $sourceWarnings,
            'segments_preview'       => $preview,
            'style_json'             => $style,
            'job_id'                 => $jobId !== '' ? $jobId : null,
            'status'                 => $status,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
