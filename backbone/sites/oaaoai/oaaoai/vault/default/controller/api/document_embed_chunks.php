<?php

declare(strict_types=1);

use oaaoai\vault\VaultQdrantCollectionResolver;
use oaaoai\vault\VaultQdrantPoints;

/**
 * GET /vault/api/document_embed_chunks — list Qdrant chunk payloads for an embedded document.
 *
 * Query: {@code document_id} (required), optional {@code workspace_id}, optional {@code count_only=1}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $query */
    $query = [];
    if (isset($_GET['workspace_id']) && (is_string($_GET['workspace_id']) || is_numeric($_GET['workspace_id']))) {
        $query['workspace_id'] = $_GET['workspace_id'];
    }

    $ctx = $this->oaao_vault_require_pg_api_context($query);
    if ($ctx === null) {
        return;
    }

    $docId = isset($_GET['document_id']) ? (int) $_GET['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $countOnly = isset($_GET['count_only']) && in_array(
        strtolower(trim((string) $_GET['count_only'])),
        ['1', 'true', 'yes'],
        true,
    );

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, file_name, mime_type, embed_status')
        ->from('vault_document')
        ->where('id=:id')
        ->assign(['id' => $docId])
        ->limit(1)
        ->query()
        ->fetch();

    if ($doc === false || ! \is_array($doc)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $vaultId = (int) ($doc['vault_id'] ?? 0);
    if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $embedStatus = isset($doc['embed_status']) ? strtolower(trim((string) $doc['embed_status'])) : '';
    if ($embedStatus !== 'embedded') {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'Document is not embedded yet',
            'data'    => ['embed_status' => $embedStatus !== '' ? $embedStatus : null],
        ]);

        return;
    }

    /** @var array<string, mixed>|false $vr */
    $vr = $db->prepare()
        ->select('id, scope, workspace_id, owner_user_id, qdrant_url, qdrant_collection, qdrant_api_key_ref')
        ->from('vault')
        ->where('id=:vid')
        ->assign(['vid' => $vaultId])
        ->limit(1)
        ->query()
        ->fetch();

    if ($vr === false || ! \is_array($vr)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Vault not found']);

        return;
    }

    $collection = VaultQdrantCollectionResolver::resolveEffectiveCollection($vr);
    if ($collection === null || $collection === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Qdrant collection not configured for this vault']);

        return;
    }

    if ($countOnly) {
        $count = VaultQdrantPoints::countEmbeddingsForDocument($vr, $vaultId, $docId);
        if ($count === null) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Could not read chunk count from Qdrant']);

            return;
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id'  => $docId,
                'vault_id'     => $vaultId,
                'file_name'    => (string) ($doc['file_name'] ?? ''),
                'collection'   => $collection,
                'chunk_count'  => $count,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $chunks = VaultQdrantPoints::scrollEmbeddingsForDocument($vr, $vaultId, $docId);
    if ($chunks === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Could not load chunks from Qdrant']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'vault_id'     => $vaultId,
            'file_name'    => (string) ($doc['file_name'] ?? ''),
            'mime_type'    => (string) ($doc['mime_type'] ?? ''),
            'collection'   => $collection,
            'chunk_count'  => \count($chunks),
            'chunks'       => $chunks,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
