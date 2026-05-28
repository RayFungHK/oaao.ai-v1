<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;

/**
 * GET /corpus/api/corpus_sources_list?corpus_id=&workspace_id=&limit=&offset=
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

    $limit = isset($input['limit']) ? (int) $input['limit'] : 50;
    $offset = isset($input['offset']) ? (int) $input['offset'] : 0;

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    try {
        $page = $repo->listSourcesPage($corpusId, $limit, $offset);
        $sources = [];
        foreach ($page['sources'] as $row) {
            if (\is_array($row)) {
                $sources[] = CorpusRepository::sourceForApi($row);
            }
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'sources' => $sources,
                'total'   => (int) ($page['total'] ?? 0),
                'limit'   => max(1, min(200, $limit)),
                'offset'  => max(0, $offset),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_sources_list: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not load sources']);
    }
};
