<?php

declare(strict_types=1);

require_once __DIR__ . '/_vault_hook_jobs.php';

/** Max bytes returned for vault text preview (truncated with flag). */
const OAAO_VAULT_TEXT_PREVIEW_MAX_BYTES = 524288;

/**
 * GET /vault/api/document_text — plain text / markdown body for vault preview UI.
 *
 * Query: {@code document_id} (required), optional {@code workspace_id}.
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

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, file_name, mime_type, byte_size, storage_path, source_text')
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

    $fileName = (string) ($doc['file_name'] ?? '');
    $mime = oaao_vault_normalize_upload_mime((string) ($doc['mime_type'] ?? ''), $fileName);
    if (! oaao_vault_is_text_preview_upload($mime, $fileName)) {
        http_response_code(415);
        echo json_encode(['success' => false, 'message' => 'Text preview is supported for .txt and .md files only']);

        return;
    }

    $isMarkdown = oaao_vault_is_markdown_preview_upload($mime, $fileName);
    $byteSize = isset($doc['byte_size']) ? (int) $doc['byte_size'] : 0;
    $content = '';
    $truncated = false;

    $sourceText = isset($doc['source_text']) ? trim((string) $doc['source_text']) : '';
    if ($sourceText !== '') {
        $content = $sourceText;
    } else {
        $relPath = isset($doc['storage_path']) ? trim((string) $doc['storage_path']) : '';
        if ($relPath === '' || str_contains($relPath, '..')) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'File not stored']);

            return;
        }

        $storageRoot = realpath($this->oaao_vault_storage_root());
        if ($storageRoot === false) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Storage unavailable']);

            return;
        }

        $absPath = realpath($storageRoot . '/' . ltrim($relPath, '/'));
        $storagePrefix = rtrim($storageRoot, \DIRECTORY_SEPARATOR) . \DIRECTORY_SEPARATOR;
        if ($absPath === false || (! str_starts_with($absPath, $storagePrefix) && $absPath !== rtrim($storageRoot, \DIRECTORY_SEPARATOR))) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'File not found']);

            return;
        }

        if (! is_file($absPath) || ! is_readable($absPath)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'File not readable']);

            return;
        }

        $onDisk = filesize($absPath);
        if (\is_int($onDisk) && $onDisk > 0) {
            $byteSize = $onDisk;
        }

        $raw = @file_get_contents($absPath);
        if ($raw === false) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not read file']);

            return;
        }

        if ($raw !== '' && ! mb_check_encoding($raw, 'UTF-8')) {
            http_response_code(415);
            echo json_encode(['success' => false, 'message' => 'Preview supports UTF-8 text only']);

            return;
        }

        $content = $raw;
    }

    if (\strlen($content) > OAAO_VAULT_TEXT_PREVIEW_MAX_BYTES) {
        $content = (string) mb_substr($content, 0, OAAO_VAULT_TEXT_PREVIEW_MAX_BYTES, 'UTF-8');
        $truncated = true;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'file_name'    => $fileName,
            'mime_type'    => $mime,
            'is_markdown'  => $isMarkdown,
            'content'      => $content,
            'truncated'    => $truncated,
            'byte_size'    => $byteSize,
        ],
    ], JSON_UNESCAPED_UNICODE);
};
