<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/refetch_item_claim — internal: claim next queued refetch item (single-flight).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

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
    try {
        $item = $repo->claimRefetchItem();
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not claim refetch item',
            'data'    => ['detail' => $e->getMessage()],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($item === null) {
        echo json_encode([
            'success' => true,
            'item'    => null,
            'refetch' => $repo->countAllRefetchItems(),
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $watchId = (int) ($item['watch_id'] ?? 0);
    $knownItems = [];
    foreach ($repo->listKnownItemHashes($watchId) as $url => $hash) {
        $knownItems[] = [
            'canonical_url' => $url,
            'content_hash'  => $hash,
        ];
    }

    echo json_encode([
        'success'      => true,
        'item'         => $item,
        'refetch'      => $repo->countAllRefetchItems(),
        'summary_llm'  => oaao_research_resolve_summary_llm($this),
        'match_llm'    => oaao_research_resolve_match_llm($this),
        'known_items'  => $knownItems,
        'watch_config' => oaao_research_decode_watch_config(
            isset($item['watch_config_json']) && \is_string($item['watch_config_json']) ? $item['watch_config_json'] : null,
        ),
    ], JSON_UNESCAPED_UNICODE);
};
