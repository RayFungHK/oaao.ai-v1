<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /research/api/source_discover_step — one wizard step: classify page + rank links.
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

    $url = trim((string) ($input['url'] ?? ''));
    if ($url === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'url required']);

        return;
    }

    $llmCfg = oaao_research_resolve_discover_llm($this);

    $payload = [
        'url'            => $url,
        'depth'          => isset($input['depth']) ? (int) $input['depth'] : 1,
        'max_depth'      => isset($input['max_depth']) ? (int) $input['max_depth'] : 3,
        'parent_url'     => trim((string) ($input['parent_url'] ?? '')),
        'llm_cfg'        => $llmCfg,
        'use_llm'        => ! empty($input['use_llm']),
        'use_playwright' => ! empty($input['use_playwright']),
    ];
    if ($llmCfg !== null && ! isset($input['use_llm'])) {
        $payload['use_llm'] = true;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/research/discover_step', $payload, 120);
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
