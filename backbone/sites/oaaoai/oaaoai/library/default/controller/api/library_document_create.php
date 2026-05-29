<?php

declare(strict_types=1);

/**
 * POST /library/api/library_document_create — { "title"?: string, "workspace_id"?: int|null, "corpus_id"?: int|null }
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        $title = 'Untitled';
    }
    $title = mb_substr($title, 0, 512);

    $tenantId = (int) $ctx['tenant_id'];
    if ($tenantId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context required']);

        return;
    }

    $workspaceId = null;
    $widRaw = $input['workspace_id'] ?? null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $corpusId = null;
    $corpusRaw = $input['corpus_id'] ?? null;
    if ($corpusRaw !== null && $corpusRaw !== '' && (int) $corpusRaw > 0) {
        $corpusId = (int) $corpusRaw;
    }

    $blocks = [
        ['type' => 'paragraph', 'content' => ''],
    ];
    $blocksJson = json_encode($blocks, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

    $pdo = $ctx['pdo'];
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            'INSERT INTO oaao_library_document (tenant_id, workspace_id, title, status, corpus_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING document_id',
        );
        $st->execute([$tenantId, $workspaceId, $title, 'draft', $corpusId, $ctx['uid']]);
        $docId = (int) $st->fetchColumn();

        $stRev = $pdo->prepare(
            'INSERT INTO oaao_library_revision (document_id, version, blocks_json, created_by, created_at)
             VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP)
             RETURNING revision_id',
        );
        $stRev->execute([$docId, $blocksJson, $ctx['uid']]);
        $revId = (int) $stRev->fetchColumn();

        $stCur = $pdo->prepare(
            'UPDATE oaao_library_document SET current_revision_id = ? WHERE document_id = ?',
        );
        $stCur->execute([$revId, $docId]);

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id' => $docId,
                'revision_id' => $revId,
                'title'       => $title,
                'blocks'      => $blocks,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not create document']);
    }
};
