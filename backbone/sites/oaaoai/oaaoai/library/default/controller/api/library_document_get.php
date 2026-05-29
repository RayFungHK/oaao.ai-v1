<?php

declare(strict_types=1);

/**
 * GET /library/api/library_document_get?document_id=
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $docId = (int) ($_GET['document_id'] ?? 0);
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id required']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $st = $ctx['pdo']->prepare(
        'SELECT d.document_id, d.title, d.status, d.updated_at, d.corpus_id, d.current_revision_id,
                r.revision_id, r.version, r.blocks_json
         FROM oaao_library_document d
         LEFT JOIN LATERAL (
             SELECT revision_id, version, blocks_json
             FROM oaao_library_revision
             WHERE document_id = d.document_id
             ORDER BY version DESC, revision_id DESC
             LIMIT 1
         ) r ON true
         WHERE d.document_id = ? AND d.tenant_id = ?
         LIMIT 1',
    );
    $st->execute([$docId, $tenantId]);
    $row = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($row)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $blocks = [];
    $raw = $row['blocks_json'] ?? '';
    if (\is_string($raw) && trim($raw) !== '') {
        try {
            $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($dec)) {
                $blocks = $dec;
            }
        } catch (\JsonException) {
            $blocks = [['type' => 'paragraph', 'content' => '']];
        }
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id' => (int) $row['document_id'],
            'title'       => (string) ($row['title'] ?? ''),
            'status'      => (string) ($row['status'] ?? 'draft'),
            'revision_id' => isset($row['revision_id']) ? (int) $row['revision_id'] : null,
            'version'     => isset($row['version']) ? (int) $row['version'] : 1,
            'corpus_id'   => isset($row['corpus_id']) && $row['corpus_id'] !== null
                ? (int) $row['corpus_id']
                : null,
            'current_revision_id' => isset($row['current_revision_id']) && $row['current_revision_id'] !== null
                ? (int) $row['current_revision_id']
                : (isset($row['revision_id']) ? (int) $row['revision_id'] : null),
            'blocks'      => $blocks,
            'updated_at'  => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
