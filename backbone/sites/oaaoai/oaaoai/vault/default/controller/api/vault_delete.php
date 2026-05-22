<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_delete — delete an entire vault (containers, documents, jobs, stored files).
 *
 * JSON body: {@code vault_id} (required), optional {@code workspace_id} (shell gate).
 *
 * Best-effort: removes Qdrant points per document before rows disappear ({@see VaultQdrantPoints}).
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

    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id is required']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $storageRoot = $this->oaao_vault_storage_root();

    $db->beginTransaction();

    try {
        /** @var array<string, mixed>|false $vaultRow */
        $vaultRow = $db->prepare(
            <<<'SQL'
SELECT id FROM oaao_vault WHERE id = :id LIMIT 1 FOR UPDATE
SQL
        )
            ->assign(['id' => $vaultId])
            ->query()
            ->fetch();

        if ($vaultRow === false || ! \is_array($vaultRow)) {
            $db->rollback();
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Vault not found']);

            return;
        }

        /** @var list<string> $storagePaths */
        $storagePaths = [];
        /** @var list<int> $docIds */
        $docIds = [];

        $q = $db->prepare()
            ->select('id, storage_path')
            ->from('vault_document')
            ->where('vault_id=:vid')
            ->assign(['vid' => $vaultId])
            ->query();

        while (($row = $q->fetch()) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $docId = (int) ($row['id'] ?? 0);
            if ($docId > 0) {
                $docIds[] = $docId;
            }
            $rel = isset($row['storage_path']) && \is_string($row['storage_path']) ? $row['storage_path'] : null;
            if ($rel !== null && $rel !== '') {
                $storagePaths[] = $rel;
            }
        }

        foreach ($docIds as $docId) {
            $this->oaao_vault_best_effort_delete_qdrant_embeddings($db, $vaultId, $docId);
        }

        $db->delete('vault_document', ['vault_id' => $vaultId])->query();
        $db->delete('vault_container', ['vault_id' => $vaultId])->query();
        $db->delete('vault_job', ['vault_id' => $vaultId])->query();
        $db->delete('vault', ['id' => $vaultId])->query();

        $db->commit();

        foreach ($storagePaths as $rel) {
            $this->oaao_vault_unlink_storage_file($storageRoot, $rel);
        }

        echo json_encode(
            [
                'success' => true,
                'data'    => [
                    'vault_id'            => $vaultId,
                    'deleted_document_ids'=> $docIds,
                ],
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    } catch (\Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollback();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not delete vault',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
