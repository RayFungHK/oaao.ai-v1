<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /research/api/source_discover_finalize — build watch source config from wizard selections.
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }

    $rootUrl = trim((string) ($input['root_url'] ?? ''));
    if ($rootUrl === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'root_url required']);

        return;
    }

    $path = isset($input['path']) && \is_array($input['path']) ? $input['path'] : [];
    $selected = isset($input['selected_article_urls']) && \is_array($input['selected_article_urls'])
        ? $input['selected_article_urls']
        : [];

    $payload = [
        'root_url'               => $rootUrl,
        'path'                   => $path,
        'selected_article_urls'  => $selected,
        'final_index_url'        => trim((string) ($input['final_index_url'] ?? '')),
    ];

    $resp = ChatOrchestratorApi::postInternalJson('/v1/research/discover_finalize', $payload, 60);
    if ($resp === null) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    echo json_encode([
        'success' => ! empty($resp['ok']),
        'data'    => $resp,
    ], JSON_UNESCAPED_UNICODE);
};
