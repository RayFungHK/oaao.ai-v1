<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /library/api/library_document_convert — text → blocks via orchestrator, persist document (CS-2-S3).
 *
 * Body: { title?, text|source_text, workspace_id? }
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

    $title = trim((string) ($input['title'] ?? 'Untitled'));
    if ($title === '') {
        $title = 'Untitled';
    }
    $title = mb_substr($title, 0, 512);
    $text = trim((string) ($input['text'] ?? $input['source_text'] ?? ''));

    $resp = ChatOrchestratorApi::postInternalJson('/v1/library/convert', [
        'title' => $title,
        'text'  => $text,
    ], 30);

    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => empty($resp['ok']) ? (string) ($resp['error'] ?? 'convert_failed') : 'Orchestrator unreachable',
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $blocks = $resp['blocks'] ?? null;
    if (! \is_array($blocks) || $blocks === []) {
        $blocks = [['type' => 'paragraph', 'content' => '']];
    }
    $convTitle = trim((string) ($resp['title'] ?? $title));
    if ($convTitle === '') {
        $convTitle = $title;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $workspaceId = null;
    $widRaw = $input['workspace_id'] ?? null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $blocksJson = json_encode(array_values($blocks), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $pdo = $ctx['pdo'];
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            'INSERT INTO oaao_library_document (tenant_id, workspace_id, title, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING document_id',
        );
        $st->execute([$tenantId, $workspaceId, $convTitle, 'draft', $ctx['uid']]);
        $docId = (int) $st->fetchColumn();

        $stRev = $pdo->prepare(
            'INSERT INTO oaao_library_revision (document_id, version, blocks_json, created_by, created_at)
             VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP)
             RETURNING revision_id',
        );
        $stRev->execute([$docId, $blocksJson, $ctx['uid']]);
        $revId = (int) $stRev->fetchColumn();

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id' => $docId,
                'revision_id' => $revId,
                'title'       => $convTitle,
                'blocks'      => $blocks,
                'convert'     => $resp,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not save converted document']);
    }
};
