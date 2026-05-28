<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;
use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/**
 * POST /corpus/api/corpus_source_upload — multipart: corpus_id, file, label?, workspace_id?
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = $_POST;
    $scopeWid = oaao_corpus_resolve_workspace_scope(
        $this,
        $ctx,
        oaao_corpus_workspace_from_request($input),
    );
    if ($scopeWid === false) {
        return;
    }

    $corpusId = (int) ($input['corpus_id'] ?? 0);
    if ($corpusId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'corpus_id required']);

        return;
    }

    if (! isset($_FILES['file']) || ! \is_array($_FILES['file'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'file required']);

        return;
    }

    $file = $_FILES['file'];
    $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($err !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Upload failed']);

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

    $repo = new CorpusRepository($ctx['db']);
    $profile = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
    if ($profile === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Corpus not found']);

        return;
    }

    $label = isset($input['label']) ? trim((string) $input['label']) : '';
    if ($label === '') {
        $label = $safeBase;
    }

    try {
        $relativeKey = max(1, $corpusId) . '/' . bin2hex(random_bytes(8)) . '_' . $safeBase;
        $blob = new TenantBlobStorage($ctx['pdo'], $ctx['tenant_id'], StorageDomain::CORPUS);
        $stored = $blob->putUploadedFile($tmp, $relativeKey);
        $locatorJson = $stored->toJson();

        $sourceId = $repo->insertSource([
            'corpus_id'     => $corpusId,
            'kind'          => 'upload',
            'locator_json'  => $locatorJson,
            'label'         => $label,
            'sort_order'    => $repo->nextSourceSortOrder($corpusId),
            'byte_size'     => $byteSize,
            'mime_type'     => $mime,
        ]);

        if ($sourceId < 1) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not save source']);

            return;
        }

        $row = $repo->listSources($corpusId);
        $saved = null;
        foreach ($row as $r) {
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
                    : ['source_id' => $sourceId, 'corpus_id' => $corpusId, 'kind' => 'upload'],
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_source_upload: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not store upload']);
    }
};
