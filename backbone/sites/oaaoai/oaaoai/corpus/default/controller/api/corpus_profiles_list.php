<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;

/**
 * GET /corpus/api/corpus_profiles_list?workspace_id=
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $requestedWid = oaao_corpus_workspace_from_request([]);
    $scopeWid = oaao_corpus_resolve_workspace_scope($this, $ctx, $requestedWid);
    if ($scopeWid === false) {
        return;
    }

    $includeSources = isset($_GET['include_sources'])
        && in_array(strtolower(trim((string) $_GET['include_sources'])), ['1', 'true', 'yes'], true);

    try {
        $repo = new CorpusRepository($ctx['db']);
        $rows = $repo->listProfilesForScope($ctx['tenant_id'], $ctx['uid'], $scopeWid);
        $profiles = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $cid = (int) ($row['corpus_id'] ?? 0);
            $api = CorpusRepository::profileForApi(
                $row,
                $cid > 0 ? $repo->countSources($cid) : 0,
                $cid > 0 ? $repo->countSegments($cid) : 0,
            );
            if ($includeSources && $cid > 0) {
                $sources = [];
                foreach ($repo->listSources($cid) as $src) {
                    if (\is_array($src)) {
                        $sources[] = CorpusRepository::sourceForApi($src);
                    }
                }
                $api['sources'] = $sources;
            }
            $profiles[] = $api;
        }

        echo json_encode([
            'success'  => true,
            'data'     => ['profiles' => $profiles],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_profiles_list: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not load corpus profiles']);
    }
};
