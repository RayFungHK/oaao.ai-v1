<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /research/api/match_prompt_preview — LLM-normalize match criteria for UI preview.
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

    $prompt = trim((string) ($input['match_prompt'] ?? ''));
    if ($prompt === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'match_prompt required']);

        return;
    }

    $matchLlm = oaao_research_resolve_match_llm($this);

    $resp = ChatOrchestratorApi::postInternalJson('/v1/research/match_prompt_normalize', [
        'match_prompt' => $prompt,
        'match_llm'    => $matchLlm,
        'summary_llm'  => $matchLlm,
    ], 120);

    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Could not normalize prompt (LLM unavailable)',
        ]);

        return;
    }

    echo json_encode([
        'success'           => true,
        'normalized_prompt' => (string) ($resp['normalized_prompt'] ?? $prompt),
    ], JSON_UNESCAPED_UNICODE);
};
