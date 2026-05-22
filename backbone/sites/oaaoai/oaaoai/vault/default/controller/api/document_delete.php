<?php

declare(strict_types=1);

/**
 * POST /vault/api/document_delete — delete a vault document row, queued jobs (cascade), and stored file.
 *
 * JSON body: {@code document_id}, optional {@code workspace_id}.
 *
 * Best-effort: removes Qdrant points whose payload matches this {@code vault_id}+{@code document_id} ({@see VaultQdrantPoints}) before the DB row disappears.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $docId = isset($body['document_id']) ? (int) $body['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    $db->beginTransaction();

    try {
        /** @var array<string, mixed>|false $row */
        $row = $db->prepare(
            <<<'SQL'
SELECT id, vault_id, storage_path FROM oaao_vault_document WHERE id = :id LIMIT 1 FOR UPDATE
SQL
        )
            ->assign(['id' => $docId])
            ->query()
            ->fetch();
        if ($row === false || ! \is_array($row)) {
            $db->rollback();
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Document not found']);

            return;
        }

        $vaultId = (int) ($row['vault_id'] ?? 0);
        if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
            $db->rollback();
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Forbidden']);

            return;
        }

        $relPath = isset($row['storage_path']) && \is_string($row['storage_path']) ? $row['storage_path'] : null;

        $this->oaao_vault_best_effort_delete_qdrant_embeddings($db, $vaultId, $docId);

        $db->delete('vault_document', ['id' => $docId])->query();
        $db->commit();

        $storageRoot = $this->oaao_vault_storage_root();
        $this->oaao_vault_unlink_storage_file($storageRoot, $relPath);

        echo json_encode(['success' => true, 'data' => ['document_id' => $docId]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollback();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not delete document',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
