<?php

declare(strict_types=1);

/**
 * POST /library/api/library_revision_save — { document_id, title?, blocks: [...] }
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $docId = (int) ($input['document_id'] ?? 0);
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id required']);

        return;
    }

    $blocks = $input['blocks'] ?? null;
    if (! \is_array($blocks)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'blocks array required']);

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

    $title = trim((string) ($input['title'] ?? $doc['title'] ?? ''));
    if ($title === '') {
        $title = 'Untitled';
    }
    $title = mb_substr($title, 0, 512);

    $blocksJson = json_encode(array_values($blocks), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

    $pdo = $ctx['pdo'];
    $pdo->beginTransaction();
    try {
        $verSt = $pdo->prepare(
            'SELECT COALESCE(MAX(version), 0) FROM oaao_library_revision WHERE document_id = ?',
        );
        $verSt->execute([$docId]);
        $nextVer = (int) $verSt->fetchColumn() + 1;

        $ins = $pdo->prepare(
            'INSERT INTO oaao_library_revision (document_id, version, blocks_json, created_by, created_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             RETURNING revision_id',
        );
        $ins->execute([$docId, $nextVer, $blocksJson, $ctx['uid']]);
        $revId = (int) $ins->fetchColumn();

        $upd = $pdo->prepare(
            'UPDATE oaao_library_document SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE document_id = ?',
        );
        $upd->execute([$title, $docId]);

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id' => $docId,
                'revision_id' => $revId,
                'version'     => $nextVer,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not save revision']);
    }
};
