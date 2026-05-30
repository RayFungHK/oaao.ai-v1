<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/fetch_job_worker_context — internal: LLM + known items for background fetch.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    $watchId = \is_array($input) && isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    if ($watchId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    $repo = new ResearchRepository($db);
    $watch = $repo->getWatchById($watchId);
    if ($watch === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Watch not found']);

        return;
    }

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

    echo json_encode([
        'success'      => true,
        'watch_id'     => $watchId,
        'watch_config' => $watchConfig,
        'summary_llm'  => oaao_research_resolve_summary_llm($this),
        'match_llm'    => oaao_research_resolve_match_llm($this),
        'known_items'  => $knownItems,
    ], JSON_UNESCAPED_UNICODE);
};
