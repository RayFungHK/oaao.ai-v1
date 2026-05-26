<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /research/api/source_discover — preview page type + links before creating watch.
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

    $sources = isset($input['sources']) && \is_array($input['sources']) ? $input['sources'] : [];
    if ($sources === [] && isset($input['urls']) && \is_array($input['urls'])) {
        foreach ($input['urls'] as $u) {
            $url = trim((string) $u);
            if ($url !== '') {
                $sources[] = ['url' => $url, 'kind' => 'auto'];
            }
        }
    }
    if ($sources === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'sources or urls required']);

        return;
    }

    $llmCfg = oaao_research_resolve_discover_llm($this);

    $payload = [
        'sources'        => $sources,
        'llm_cfg'        => $llmCfg,
        'use_llm'        => ! empty($input['use_llm']),
        'use_playwright' => ! empty($input['use_playwright']),
        'keyword_filter' => trim((string) ($input['keyword_filter'] ?? '')),
    ];
    if ($llmCfg !== null && ! isset($input['use_llm'])) {
        $payload['use_llm'] = true;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/research/discover', $payload, 120);
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
