<?php

declare(strict_types=1);

require_once __DIR__ . '/_vault_hook_jobs.php';

/**
 * GET /vault/api/document_media — stream vault audio/video for transcript playback (Range-aware).
 *
 * Query: {@code document_id} (required), optional {@code workspace_id}.
 */
return function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        header('Content-Type: application/json; charset=UTF-8');
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
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, file_name, mime_type, byte_size, storage_path')
        ->from('vault_document')
        ->where('id=:id')
        ->assign(['id' => $docId])
        ->limit(1)
        ->query()
        ->fetch();

    if ($doc === false || ! \is_array($doc)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $vaultId = (int) ($doc['vault_id'] ?? 0);
    if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $fileName = (string) ($doc['file_name'] ?? '');
    $mime = oaao_vault_normalize_upload_mime((string) ($doc['mime_type'] ?? ''), $fileName);
    if (! oaao_vault_is_audio_upload($mime, $fileName)) {
        http_response_code(415);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Media playback is supported for audio files only']);

        return;
    }

    $relPath = isset($doc['storage_path']) ? trim((string) $doc['storage_path']) : '';
    if ($relPath === '' || str_contains($relPath, '..')) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'File not stored']);

        return;
    }

    $storageRoot = realpath($this->oaao_vault_storage_root());
    if ($storageRoot === false) {
        http_response_code(503);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Storage unavailable']);

        return;
    }

    $absPath = realpath($storageRoot . '/' . ltrim($relPath, '/'));
    $storagePrefix = rtrim($storageRoot, \DIRECTORY_SEPARATOR) . \DIRECTORY_SEPARATOR;
    if ($absPath === false || (! str_starts_with($absPath, $storagePrefix) && $absPath !== rtrim($storageRoot, \DIRECTORY_SEPARATOR))) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'File not found']);

        return;
    }

    if (! is_file($absPath) || ! is_readable($absPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'File not readable']);

        return;
    }

    $size = filesize($absPath);
    if ($size === false) {
        $size = isset($doc['byte_size']) ? (int) $doc['byte_size'] : 0;
    }

    $this->oaao_vault_stream_binary_file($absPath, $mime, $fileName, (int) $size);
};
