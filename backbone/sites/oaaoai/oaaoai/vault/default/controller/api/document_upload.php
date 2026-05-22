<?php

declare(strict_types=1);

require_once __DIR__ . '/_vault_hook_jobs.php';

/**
 * POST /vault/api/document_upload — multipart upload ({@code file}) into scoped vault storage + enqueue ingest jobs.
 *
 * Form fields: {@code workspace_id} optional; {@code vault_id}, {@code container_id} optional.
 *
 * When {@code oaao_vault.is_enabled} is {@code 0}, the file is stored but ingest hooks are **not** queued; {@code embed_status} starts as {@code held}
 * until {@code document_enqueue} or another explicit pipeline step runs ({@see Controller::oaao_vault_auto_rag_ingest_enabled}).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $post */
    $post = \is_array($_POST) ? $_POST : [];

    $ctx = $this->oaao_vault_require_pg_api_context($post);
    if ($ctx === null) {
        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! isset($_FILES['file']) || ! \is_array($_FILES['file'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Missing file field']);

        return;
    }

    /** @var array<string, mixed> $f */
    $f = $_FILES['file'];
    $err = (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($err !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Upload failed', 'data' => ['upload_error' => $err]]);

        return;
    }

    $tmp = isset($f['tmp_name']) && \is_string($f['tmp_name']) ? $f['tmp_name'] : '';
    if ($tmp === '' || ! is_uploaded_file($tmp)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid upload']);

        return;
    }

    $maxBytes = 50 * 1024 * 1024;
    $size = isset($f['size']) ? (int) $f['size'] : 0;
    if ($size < 1 || $size > $maxBytes) {
        http_response_code(413);
        echo json_encode(['success' => false, 'message' => 'File too large (max 50 MiB)']);

        return;
    }

    $origName = isset($f['name']) && \is_string($f['name']) ? $f['name'] : 'upload.bin';
    $declaredMime = isset($f['type']) && \is_string($f['type']) ? trim($f['type']) : '';

    $detectedMime = '';
    if (\function_exists('finfo_open')) {
        $fh = finfo_open(FILEINFO_MIME_TYPE);
        if ($fh !== false) {
            $m = finfo_file($fh, $tmp);
            finfo_close($fh);
            if (\is_string($m)) {
                $detectedMime = trim($m);
            }
        }
    }

    $mime = $detectedMime !== '' ? $detectedMime : $declaredMime;
    if ($mime === '') {
        $mime = 'application/octet-stream';
    }
    $mime = oaao_vault_normalize_upload_mime($mime, $origName);

    $vaultIdOpt = isset($post['vault_id']) && is_numeric($post['vault_id']) ? (int) $post['vault_id'] : 0;
    $containerIdOpt = isset($post['container_id']) && is_numeric($post['container_id']) ? (int) $post['container_id'] : 0;

    $vaultId = $vaultIdOpt > 0 ? $vaultIdOpt : $this->oaao_vault_ensure_default_vault($db, $uid, $wid);

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Vault not accessible in this scope']);

        return;
    }

    $containerId = null;
    if ($containerIdOpt > 0) {
        if (! $this->oaao_vault_container_belongs_to_vault($db, $containerIdOpt, $vaultId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'container_id does not belong to vault']);

            return;
        }
        $containerId = $containerIdOpt;
    }

    $ragAutoIngest = $this->oaao_vault_auto_rag_ingest_enabled($db, $vaultId);
    $initialEmbedStatus = $ragAutoIngest ? 'pending' : 'held';

    $storageRoot = $this->oaao_vault_storage_root();
    if (! is_dir($storageRoot) && ! @mkdir($storageRoot, 0775, true) && ! is_dir($storageRoot)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault storage directory unavailable']);

        return;
    }

    $safeBase = basename(str_replace(["\0", '/'], '', $origName));
    $safeBase = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $safeBase) ?? 'upload.bin';
    if ($safeBase === '') {
        $safeBase = 'upload.bin';
    }

    $destAbs = null;

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
            'created_at',
            'updated_at',
        ])
            ->assign([
                'vault_id'      => $vaultId,
                'container_id'  => $containerId,
                'file_name'     => $origName,
                'mime_type'     => $mime,
                'storage_path'  => null,
                'byte_size'     => null,
                'created_by'    => $uid,
                'embed_status'  => $initialEmbedStatus,
                'created_at'    => $tsIns,
                'updated_at'    => null,
            ])
            ->query();
        $docId = $db->lastID();
        if ($docId < 1) {
            throw new \RuntimeException('document insert failed');
        }

        $relPath = $vaultId . '/' . $docId . '_' . $safeBase;
        $destDir = $storageRoot . '/' . $vaultId;
        if (! is_dir($destDir) && ! @mkdir($destDir, 0775, true) && ! is_dir($destDir)) {
            throw new \RuntimeException('vault directory mkdir failed');
        }

        $destAbs = $storageRoot . '/' . $relPath;
        if (! move_uploaded_file($tmp, $destAbs)) {
            throw new \RuntimeException('move_uploaded_file failed');
        }

        $onDisk = filesize($destAbs);
        $byteSize = \is_int($onDisk) ? $onDisk : $size;

        $tsUp = date('Y-m-d H:i:s');
        $db->update('vault_document', ['storage_path', 'byte_size', 'updated_at'])
            ->where('id=:id')
            ->assign([
                'storage_path' => $relPath,
                'byte_size'    => $byteSize,
                'updated_at'   => $tsUp,
                'id'           => $docId,
            ])
            ->query();

        $jobIds = [];
        if ($ragAutoIngest) {
            $hookIds = oaao_vault_infer_job_hook_ids($mime, $origName);

            foreach ($hookIds as $hookId) {
                $payload = [
                    'relative_path'  => $relPath,
                    'storage_root'   => $storageRoot,
                    'mime_type'      => $mime,
                    'byte_size'      => $byteSize,
                    'original_name'  => $origName,
                    'document_id'    => $docId,
                    'vault_id'       => $vaultId,
                ];
                if ($hookId === 'vh.rag.graph_index' || $hookId === 'vh.rag.document_embed') {
                    $payload = $this->oaao_vault_merge_graphrag_job_payload($db, $vaultId, $payload);
                }
                if ($hookId === 'vh.rag.audio_asr') {
                    $payload = $this->oaao_vault_merge_asr_job_payload($db, $vaultId, $wid, $payload);
                }
                $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

                $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid, $hookId, $pj);
                if ($jid > 0) {
                    $jobIds[] = ['job_id' => $jid, 'hook_id' => $hookId];
                }
            }
        }

        $db->commit();

        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id'        => $docId,
                'vault_id'           => $vaultId,
                'container_id'       => $containerId,
                'byte_size'          => $byteSize,
                'mime_type'          => $mime,
                'jobs_queued'        => $jobIds,
                'auto_rag_ingest'    => $ragAutoIngest,
                'embed_status'       => $initialEmbedStatus,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        $db->rollback();
        if (isset($destAbs) && \is_string($destAbs) && is_file($destAbs)) {
            @unlink($destAbs);
        }

        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Vault upload failed',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
