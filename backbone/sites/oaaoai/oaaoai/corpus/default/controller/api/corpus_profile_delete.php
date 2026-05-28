<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;
use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/**
 * POST /corpus/api/corpus_profile_delete — body { corpus_id, workspace_id? }
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
    if ($corpusId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id required']);

        return;
    }

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    try {
        $blob = new TenantBlobStorage($ctx['pdo'], $ctx['tenant_id'], StorageDomain::CORPUS);
        foreach ($repo->listSources($corpusId) as $src) {
            if (! \is_array($src) || ($src['kind'] ?? '') !== 'upload') {
                continue;
            }
            $locator = isset($src['locator_json']) ? (string) $src['locator_json'] : '';
            if ($locator === '') {
                continue;
            }
            $blob->delete($locator, null);
        }

        $repo->deleteProfile($corpusId);

        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_profile_delete: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not delete corpus']);
    }
};
