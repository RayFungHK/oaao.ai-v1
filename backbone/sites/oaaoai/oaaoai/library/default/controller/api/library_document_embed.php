<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\library\LibraryEmbedBootstrap;

/**
 * POST /library/api/library_document_embed — enqueue Soft-RAG embed (CS-2-S7).
 *
 * Body: { document_id, revision_id?, blocks?, title? }
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $docId = (int) ($input['document_id'] ?? 0);
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id required']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $st = $ctx['pdo']->prepare(
        'SELECT document_id, title FROM oaao_library_document WHERE document_id = ? AND tenant_id = ? LIMIT 1',
    );
    $st->execute([$docId, $tenantId]);
    $doc = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($doc)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $blocks = $input['blocks'] ?? null;
    $revisionId = (int) ($input['revision_id'] ?? 0);
    if (! \is_array($blocks) || $blocks === []) {
        $revSt = $ctx['pdo']->prepare(
            'SELECT revision_id, blocks_json FROM oaao_library_revision
             WHERE document_id = ? ORDER BY version DESC LIMIT 1',
        );
        $revSt->execute([$docId]);
        $rev = $revSt->fetch(\PDO::FETCH_ASSOC);
        if (! \is_array($rev)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'No revision to embed']);

            return;
        }
        if ($revisionId < 1) {
            $revisionId = (int) ($rev['revision_id'] ?? 0);
        }
        $decoded = json_decode((string) ($rev['blocks_json'] ?? '[]'), true);
        $blocks = \is_array($decoded) ? $decoded : [];
    }

    if ($blocks === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'blocks required']);

        return;
    }

    require_once dirname(__DIR__, 2) . '/library/LibraryEmbedBootstrap.php';

    $emb = LibraryEmbedBootstrap::resolveEmbedding($this);
    $embCfg = LibraryEmbedBootstrap::embeddingCfgForPayload($emb);

    $title = trim((string) ($input['title'] ?? $doc['title'] ?? ''));
    $payload = [
        'tenant_id'   => $tenantId,
        'document_id' => $docId,
        'revision_id' => $revisionId > 0 ? $revisionId : null,
        'title'       => $title !== '' ? $title : 'Untitled',
        'blocks'      => array_values($blocks),
    ];
    if ($embCfg !== null) {
        $payload['embedding_cfg'] = $embCfg;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/library/embed', $payload, 90);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'embed_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => $resp,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
