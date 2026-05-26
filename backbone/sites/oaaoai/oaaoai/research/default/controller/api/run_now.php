<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\research\ResearchItemPurge;
use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/run_now — trigger orchestrator research worker for one watch.
 */
return function (): void {
    @set_time_limit(0);
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    if ($watchId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id required']);

        return;
    }

    $repo = new ResearchRepository($ctx['db']);
    $watch = $repo->getWatch($watchId, $ctx['tenant_id'], $ctx['uid']);
    if ($watch === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Watch not found']);

        return;
    }

    $sources = $repo->listSources($watchId);
    $runId = $repo->insertRun([
        'watch_id'   => $watchId,
        'status'     => 'running',
        'started_at' => gmdate('Y-m-d H:i:s'),
        'created_at' => gmdate('Y-m-d H:i:s'),
    ]);

    $endpoints = $this->api('endpoints');
    $workerLlms = oaao_research_resolve_worker_llms($this);
    $summaryLlm = $workerLlms['summary_llm'];
    $matchLlm = $workerLlms['match_llm'];

    $embPayload = $endpoints ? $endpoints->resolveOrchestratorEmbeddingPayload() : null;

    $forceRefetch = ! empty($input['force_refetch']);
    $refetchItems = [];
    if ($forceRefetch) {
        $vaultId = (int) ($watch['vault_id'] ?? 0);
        ResearchItemPurge::purgeWatchStoredArtifacts($ctx['db'], $watchId, $vaultId);
        $refetchItems = $repo->listItemsForRefetch($watchId);
        $repo->clearQueuedFetchJobs($watchId);
        $repo->clearSourceIndexHashes($watchId);
        $knownHashes = [];
        $knownItems = [];
    } else {
        $knownHashes = $repo->listKnownItemHashes($watchId);
        $knownItems = [];
        foreach ($knownHashes as $url => $hash) {
            $knownItems[] = [
                'canonical_url' => $url,
                'content_hash'  => $hash,
            ];
        }
    }

    $watchConfig = oaao_research_decode_watch_config(
        isset($watch['config_json']) && \is_string($watch['config_json']) ? $watch['config_json'] : null,
    );
    $apiUrls = oaao_research_worker_api_urls();

    $payload = array_merge($apiUrls, [
        'run_id'       => $runId,
        'watch'        => $watch,
        'watch_config' => $watchConfig,
        'sources'      => $sources,
        'user_id'      => $ctx['uid'],
        'tenant_id'    => $ctx['tenant_id'],
        'summary_llm'  => $summaryLlm,
        'match_llm'    => $matchLlm,
        'embedding'    => $embPayload,
        'known_urls'   => array_keys($knownHashes),
        'known_items'  => $knownItems,
        'refetch_items'=> $refetchItems,
        'force_refetch'=> $forceRefetch,
    ]);

    $resp = ChatOrchestratorApi::postInternalJson('/v1/research/run', $payload, 180);
    if ($resp === null) {
        $repo->updateRun($runId, [
            'status'      => 'failed',
            'error_text'  => 'orchestrator_unreachable',
            'finished_at' => gmdate('Y-m-d H:i:s'),
        ]);
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable']);

        return;
    }

    $stats = isset($resp['stats']) && \is_array($resp['stats']) ? $resp['stats'] : $resp;
    $failed = ! empty($resp['error']) || (isset($resp['ok']) && $resp['ok'] === false);
    try {
        $statsJson = json_encode($stats, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        $statsJson = null;
    }

    $repo->updateRun($runId, [
        'status'      => $failed ? 'failed' : 'done',
        'stats_json'  => $statsJson,
        'error_text'  => $failed ? (string) ($resp['error'] ?? 'worker_failed') : null,
        'finished_at' => gmdate('Y-m-d H:i:s'),
    ]);
    $repo->updateWatch($watchId, oaao_research_schedule_patch_after_run($watch));

    echo json_encode([
        'success' => ! $failed,
        'run_id'  => $runId,
        'stats'   => $stats,
        'data'    => $resp,
    ], JSON_UNESCAPED_UNICODE);
};
