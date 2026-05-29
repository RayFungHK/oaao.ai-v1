<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /library/api/library_document_convert_upload — multipart file → blocks (CS-2-S3).
 *
 * Fields: file (required), title?, workspace_id?
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $file = $_FILES['file'] ?? null;
    if (! \is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'file upload required']);

        return;
    }

    $tmp = (string) ($file['tmp_name'] ?? '');
    if ($tmp === '' || ! is_uploaded_file($tmp)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid upload']);

        return;
    }

    $byteSize = (int) ($file['size'] ?? 0);
    if ($byteSize < 1 || $byteSize > 50 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'File must be between 1 byte and 50 MB']);

        return;
    }

    $origName = (string) ($file['name'] ?? 'upload.bin');
    $mime = (string) ($file['type'] ?? 'application/octet-stream');
    $safeBase = basename(str_replace(["\0", '/'], '', $origName));
    $safeBase = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $safeBase) ?? 'upload.bin';
    if ($safeBase === '') {
        $safeBase = 'upload.bin';
    }

    $title = trim((string) ($_POST['title'] ?? ''));
    if ($title === '') {
        $title = preg_replace('/\.[^.]+$/', '', $safeBase) ?: 'Imported';
    }
    $title = mb_substr($title, 0, 512);

    $workspaceId = null;
    $widRaw = $_POST['workspace_id'] ?? null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $tempPath = sys_get_temp_dir() . '/oaao-lib-' . bin2hex(random_bytes(8)) . '_' . $safeBase;
    if (! @move_uploaded_file($tmp, $tempPath)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not stage upload']);

        return;
    }

    try {
        $resp = ChatOrchestratorApi::postInternalJson('/v1/library/convert', [
            'title'          => $title,
            'absolute_path'  => $tempPath,
            'mime_type'      => $mime,
            'file_name'      => $safeBase,
        ], 120);
    } finally {
        if (is_file($tempPath)) {
            @unlink($tempPath);
        }
    }

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
