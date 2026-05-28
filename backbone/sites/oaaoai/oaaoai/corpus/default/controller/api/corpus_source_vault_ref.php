<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;
use oaaoai\corpus\CorpusVaultGuard;

/**
 * POST /corpus/api/corpus_source_vault_ref — attach vault container or document ref.
 *
 * Body: { corpus_id, vault_id, kind: vault_container|vault_document, container_id?, document_id?, label?, workspace_id? }
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
    $vaultId = (int) ($input['vault_id'] ?? 0);
    $kind = trim((string) ($input['kind'] ?? ''));

    if ($corpusId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id and vault_id required']);

        return;
    }

    if (! \in_array($kind, ['vault_container', 'vault_document'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'kind must be vault_container or vault_document']);

        return;
    }

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    $vaultScope = CorpusVaultGuard::vaultScope($ctx['db'], $vaultId, $ctx['tenant_id']);
    if ($vaultScope === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Vault not found']);

        return;
    }

    $vaultWid = $vaultScope['workspace_id'];
    $touchWid = $vaultWid ?? $scopeWid;
    if (! CorpusVaultGuard::userCanTouchVault($ctx['db'], $ctx['tenant_id'], $vaultId, $ctx['uid'], $touchWid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Vault not accessible']);

        return;
    }

    $containerId = isset($input['container_id']) ? (int) $input['container_id'] : 0;
    $documentId = isset($input['document_id']) ? (int) $input['document_id'] : 0;

    if ($kind === 'vault_container') {
        if ($containerId < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'container_id required']);

            return;
        }
        if (! CorpusVaultGuard::containerBelongsToVault($ctx['db'], $containerId, $vaultId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'container_id does not belong to vault']);

            return;
        }
    } else {
        if ($documentId < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'document_id required']);

            return;
        }
        if (! CorpusVaultGuard::documentBelongsToVault($ctx['db'], $documentId, $vaultId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'document_id does not belong to vault']);

            return;
        }
    }

    $label = isset($input['label']) ? trim((string) $input['label']) : '';
    if ($label === '') {
        if ($kind === 'vault_document') {
            $doc = $ctx['db']->prepare()
                ->select('file_name')
                ->from('vault_document')
                ->where('id=:id')
                ->assign(['id' => $documentId])
                ->limit(1)
                ->query()
                ->fetch();
            $label = \is_array($doc) ? (string) ($doc['file_name'] ?? 'Vault document') : 'Vault document';
        } else {
            $ctr = $ctx['db']->prepare()
                ->select('name')
                ->from('vault_container')
                ->where('id=:id')
                ->assign(['id' => $containerId])
                ->limit(1)
                ->query()
                ->fetch();
            $label = \is_array($ctr) ? (string) ($ctr['name'] ?? 'Vault folder') : 'Vault folder';
        }
    }

    $locator = [
        'vault_id' => $vaultId,
    ];
    if ($kind === 'vault_container') {
        $locator['container_id'] = $containerId;
    } else {
        $locator['document_id'] = $documentId;
    }

    try {
        $locatorJson = json_encode($locator, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $sourceId = $repo->insertSource([
            'corpus_id'    => $corpusId,
            'kind'         => $kind,
            'locator_json' => $locatorJson,
            'label'        => $label,
            'sort_order'   => $repo->nextSourceSortOrder($corpusId),
            'byte_size'    => null,
            'mime_type'    => null,
        ]);

        if ($sourceId < 1) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not save vault reference']);

            return;
        }

        $saved = null;
        foreach ($repo->listSources($corpusId) as $r) {
            if (\is_array($r) && (int) ($r['source_id'] ?? 0) === $sourceId) {
                $saved = $r;
                break;
            }
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'source' => $saved !== null
                    ? CorpusRepository::sourceForApi($saved)
                    : ['source_id' => $sourceId, 'corpus_id' => $corpusId, 'kind' => $kind],
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_source_vault_ref: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not save vault reference']);
    }
};
