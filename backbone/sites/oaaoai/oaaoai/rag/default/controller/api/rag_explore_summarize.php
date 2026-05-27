<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\LlmOrchestratorPayload;

/**
 * POST /rag/api/rag_explore_summarize — LLM briefing from explore passages + graph entities.
 *
 * JSON: { query: string, passages?: array, graph?: { nodes?, edges? } }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable', 'error' => 'auth_unavailable']);

        return;
    }
    $auth->restrict(true);
    if (! $auth->getUser()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated', 'error' => 'unauthenticated']);

        return;
    }

    $raw = file_get_contents('php://input');
    $body = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (! \is_array($body)) {
        $body = [];
    }

    $query = trim((string) ($body['query'] ?? ''));
    if ($query === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'query is required', 'error' => 'query_required']);

        return;
    }

    /** @var list<array<string, mixed>> $passages */
    $passages = [];
    if (isset($body['passages']) && \is_array($body['passages'])) {
        foreach ($body['passages'] as $row) {
            if (\is_array($row)) {
                $passages[] = $row;
            }
        }
    }

    $graph = isset($body['graph']) && \is_array($body['graph']) ? $body['graph'] : ['nodes' => [], 'edges' => []];

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable', 'error' => 'db_unavailable']);

        return;
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
    $chatApi = $this->api('chat');
    $llm = null;
    $llmPurpose = '';
    // Fast briefing: prefer chat.primary (often the Fast endpoint), then planner, then vault summary.
    foreach ([
        $repo->resolveChatBinding(),
        $repo->resolvePlanningBinding(),
        $repo->resolveVaultSummaryBinding(),
    ] as $binding) {
        if ($binding === null) {
            continue;
        }
        $candidate = LlmOrchestratorPayload::fromBinding($binding, $chatApi);
        if ($candidate !== null) {
            $llm = $candidate;
            $llmPurpose = (string) ($candidate['purpose_key'] ?? '');
            break;
        }
    }

    if ($llm === null) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'No LLM purpose configured — assign chat.primary (Fast) in Settings, or planning.primary / vault.primary as fallback.',
            'error'   => 'llm_unavailable',
        ]);

        return;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/vault/rag/explore/summarize', [
        'query'     => $query,
        'passages'  => $passages,
        'graph'     => $graph,
        'llm'       => $llm,
    ], 120);

    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator summarize unavailable.',
            'error'   => 'orchestrator_unavailable',
        ]);

        return;
    }

    $data = $resp['data'] ?? [];
    if (! \is_array($data)) {
        $data = [];
    }

    echo json_encode([
        'success' => true,
        'data'    => array_merge($data, $llmPurpose !== '' ? ['llm_purpose' => $llmPurpose] : []),
    ], JSON_UNESCAPED_UNICODE);
};
