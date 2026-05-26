<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/cron_run — run all due watches (internal token or authenticated owner batch).
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    $internal = \is_string($hdr) && $hdr !== '' && hash_equals($secret, $hdr);

    $repo = new ResearchRepository($ctx['db']);
    $due = $repo->listDueWatches(20);
    if ($due === []) {
        echo json_encode(['success' => true, 'ran' => 0, 'results' => []], JSON_UNESCAPED_UNICODE);

        return;
    }

    $endpoints = $this->api('endpoints');
    $workerLlms = oaao_research_resolve_worker_llms($this);
    $summaryLlm = $workerLlms['summary_llm'];
    $matchLlm = $workerLlms['match_llm'];
    $embPayload = $endpoints ? $endpoints->resolveOrchestratorEmbeddingPayload() : null;
    $apiUrls = oaao_research_worker_api_urls();

    $results = [];
    $ran = 0;
    foreach ($due as $watch) {
        if (! \is_array($watch)) {
            continue;
        }
        $watchId = (int) ($watch['watch_id'] ?? 0);
        $ownerId = (int) ($watch['owner_user_id'] ?? 0);
        if ($watchId < 1) {
            continue;
        }
        if (! $internal && $ownerId !== $ctx['uid']) {
            continue;
        }

        $sources = $repo->listSources($watchId);
        $runId = $repo->insertRun([
            'watch_id'   => $watchId,
            'status'     => 'running',
            'started_at' => gmdate('Y-m-d H:i:s'),
            'created_at' => gmdate('Y-m-d H:i:s'),
        ]);

        $knownHashes = $repo->listKnownItemHashes($watchId);
        $knownItems = [];
        foreach ($knownHashes as $url => $hash) {
            $knownItems[] = [
                'canonical_url' => $url,
                'content_hash'  => $hash,
            ];
        }
        $watchConfig = oaao_research_decode_watch_config(
            isset($watch['config_json']) && \is_string($watch['config_json']) ? $watch['config_json'] : null,
        );
        $payload = array_merge($apiUrls, [
            'run_id'       => $runId,
            'watch'        => $watch,
            'watch_config' => $watchConfig,
            'sources'      => $sources,
            'user_id'      => $ownerId > 0 ? $ownerId : $ctx['uid'],
            'tenant_id'    => (int) ($watch['tenant_id'] ?? $ctx['tenant_id']),
            'summary_llm'  => $summaryLlm,
            'match_llm'    => $matchLlm,
            'embedding'    => $embPayload,
            'known_urls'   => array_keys($knownHashes),
            'known_items'  => $knownItems,
        ]);

        $resp = ChatOrchestratorApi::postInternalJson('/v1/research/run', $payload, 300);
        $failed = $resp === null || ! empty($resp['error']) || (isset($resp['ok']) && $resp['ok'] === false);
        $stats = isset($resp['stats']) && \is_array($resp['stats']) ? $resp['stats'] : ($resp ?? []);
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

        $results[] = ['watch_id' => $watchId, 'run_id' => $runId, 'success' => ! $failed];
        $ran++;
    }

    echo json_encode(['success' => true, 'ran' => $ran, 'results' => $results], JSON_UNESCAPED_UNICODE);
};
