<?php

declare(strict_types=1);

require_once __DIR__ . '/_vault_hook_jobs.php';

/**
 * POST /vault/api/document_upload_text — internal JSON upload of markdown/text content.
 *
 * Headers: {@code X-OAAO-Internal-Token}
 * Body: user_id, vault_id, container_id?, workspace_id?, filename, content, mime_type?
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! $this->oaao_vault_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $pdo = $this->oaao_vault_sidecar_require_pdo();
    if ($pdo === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $uid = isset($input['user_id']) ? (int) $input['user_id'] : 0;
    $vaultId = isset($input['vault_id']) ? (int) $input['vault_id'] : 0;
    $containerIdOpt = isset($input['container_id']) && is_numeric($input['container_id']) ? (int) $input['container_id'] : 0;
    $wid = isset($input['workspace_id']) && is_numeric($input['workspace_id']) ? (int) $input['workspace_id'] : 0;
    $filename = trim((string) ($input['filename'] ?? 'document.md'));
    $content = isset($input['content']) ? (string) $input['content'] : '';

    if ($uid < 1 || $vaultId < 1 || $content === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'user_id, vault_id, content required']);

        return;
    }

    if ($filename === '') {
        $filename = 'document.md';
    }
    if (! str_contains(strtolower($filename), '.')) {
        $filename .= '.md';
    }

    $mime = trim((string) ($input['mime_type'] ?? 'text/markdown'));
    if ($mime === '') {
        $mime = 'text/markdown';
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $containerId = null;
    if ($containerIdOpt > 0) {
        if (! $this->oaao_vault_container_belongs_to_vault($db, $containerIdOpt, $vaultId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'container_id invalid']);

            return;
        }
        $containerId = $containerIdOpt;
    }

    $ragAutoIngest = $this->oaao_vault_auto_rag_ingest_enabled($db, $vaultId);
    $initialEmbedStatus = $ragAutoIngest ? 'pending' : 'held';

    $storageRoot = $this->oaao_vault_storage_root();
    if (! is_dir($storageRoot) && ! @mkdir($storageRoot, 0775, true) && ! is_dir($storageRoot)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault storage unavailable']);

        return;
    }

    $safeBase = basename(str_replace(["\0", '/'], '', $filename));
    $safeBase = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $safeBase) ?? 'document.md';

    $byteSize = strlen($content);
    $destAbs = null;

    $metaRoot = [
        'source'            => 'research',
        'research_managed'  => true,
    ];
    if (isset($input['watch_id']) && is_numeric($input['watch_id']) && (int) $input['watch_id'] > 0) {
        $metaRoot['watch_id'] = (int) $input['watch_id'];
    }
    if (isset($input['canonical_url']) && \is_string($input['canonical_url']) && trim($input['canonical_url']) !== '') {
        $metaRoot['canonical_url'] = trim($input['canonical_url']);
    }
    if (isset($input['content_hash']) && \is_string($input['content_hash']) && trim($input['content_hash']) !== '') {
        $metaRoot['content_hash'] = trim($input['content_hash']);
    }
    try {
        $metaJson = json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        $metaJson = null;
    }

    $db->beginTransaction();

    try {
        $tsIns = date('Y-m-d H:i:s');
        $db->insert('vault_document', [
            'vault_id',
            'container_id',
            'file_name',
            'mime_type',
            'storage_path',
            'byte_size',
            'created_by',
            'embed_status',
            'meta_json',
            'created_at',
            'updated_at',
        ])
            ->assign([
                'vault_id'     => $vaultId,
                'container_id' => $containerId,
                'file_name'    => $filename,
                'mime_type'    => $mime,
                'storage_path' => null,
                'byte_size'    => null,
                'created_by'   => $uid,
                'embed_status' => $initialEmbedStatus,
                'meta_json'    => $metaJson,
                'created_at'   => $tsIns,
                'updated_at'   => null,
            ])
            ->query();
        $docId = $db->lastID();
        if ($docId < 1) {
            throw new \RuntimeException('document insert failed');
        }

        $relPath = $vaultId . '/' . $docId . '_' . $safeBase;
        $destDir = $storageRoot . '/' . $vaultId;
        if (! is_dir($destDir) && ! @mkdir($destDir, 0775, true) && ! is_dir($destDir)) {
            throw new \RuntimeException('mkdir failed');
        }

        $destAbs = $storageRoot . '/' . $relPath;
        if (file_put_contents($destAbs, $content) === false) {
            throw new \RuntimeException('write failed');
        }

        $db->update('vault_document', ['storage_path', 'byte_size', 'updated_at'])
            ->where('id=:id')
            ->assign([
                'storage_path' => $relPath,
                'byte_size'    => $byteSize,
                'updated_at'   => date('Y-m-d H:i:s'),
                'id'           => $docId,
            ])
            ->query();

        $jobIds = [];
        if ($ragAutoIngest) {
            $hookIds = oaao_vault_infer_job_hook_ids($mime, $filename);
            foreach ($hookIds as $hookId) {
                $payload = [
                    'relative_path' => $relPath,
                    'storage_root'  => $storageRoot,
                    'mime_type'     => $mime,
                    'byte_size'     => $byteSize,
                    'original_name' => $filename,
                    'document_id'   => $docId,
                    'vault_id'      => $vaultId,
                    'source'        => 'research',
                ];
                if ($hookId === 'vh.rag.graph_index' || $hookId === 'vh.rag.document_embed') {
                    $payload = $this->oaao_vault_merge_graphrag_job_payload($db, $vaultId, $payload);
                }
                $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid > 0 ? $wid : 0, $hookId, $pj);
                if ($jid > 0) {
                    $jobIds[] = ['job_id' => $jid, 'hook_id' => $hookId];
                }
            }
        }

        $db->commit();

        echo json_encode([
            'success'     => true,
            'document_id' => $docId,
            'job_ids'     => $jobIds,
            'path'        => $relPath,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        $db->rollback();
        if ($destAbs !== null && is_file($destAbs)) {
            @unlink($destAbs);
        }
        error_log('document_upload_text: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Upload failed']);
    }
};
