<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;
use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/**
 * POST /corpus/api/corpus_source_delete — body { corpus_id, source_id, workspace_id? }
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $scopeWid = oaao_corpus_resolve_workspace_scope(
        $this,
        $ctx,
        oaao_corpus_workspace_from_request($input),
    );
    if ($scopeWid === false) {
        return;
    }

    $corpusId = (int) ($input['corpus_id'] ?? 0);
    $sourceId = (int) ($input['source_id'] ?? 0);
    if ($corpusId < 1 || $sourceId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id and source_id required']);

        return;
    }

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    $status = (string) ($profile['status'] ?? 'draft');
    if ($status === 'learning') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'Cannot remove sources while analysis is running']);

        return;
    }

    $source = $repo->getSourceForCorpus($sourceId, $corpusId);
    if ($source === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Source not found']);

        return;
    }

    try {
        if (($source['kind'] ?? '') === 'upload') {
            $locator = isset($source['locator_json']) ? (string) $source['locator_json'] : '';
            if ($locator !== '') {
                $blob = new TenantBlobStorage($ctx['pdo'], $ctx['tenant_id'], StorageDomain::CORPUS);
                $blob->delete($locator, null);
            }
        }

        $repo->deleteSource($sourceId, $corpusId);

        echo json_encode([
            'success' => true,
            'data'    => [
                'source_count' => $repo->countSources($corpusId),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_source_delete: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not remove source']);
    }
};
