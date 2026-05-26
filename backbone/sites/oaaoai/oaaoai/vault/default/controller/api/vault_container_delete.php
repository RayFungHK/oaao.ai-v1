<?php

declare(strict_types=1);

use oaaoai\research\ResearchVaultGuard;

/**
 * POST /vault/api/vault_container_delete — delete a folder and all nested folders + their documents (files on disk removed).
 *
 * JSON body: {@code vault_id}, {@code container_id}, optional {@code workspace_id}.
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
    $containerId = isset($body['container_id']) ? (int) $body['container_id'] : 0;
    if ($vaultId < 1 || $containerId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id and container_id are required.']);

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

    if (! $this->oaao_vault_container_belongs_to_vault($db, $containerId, $vaultId)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Folder not found.']);

        return;
    }

    if (ResearchVaultGuard::containerIsManaged($db, $vaultId, $containerId)) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'message' => ResearchVaultGuard::vaultDeleteContainerMessage(),
        ]);

        return;
    }

    $subIds = $this->oaao_vault_container_subtree_ids($db, $vaultId, $containerId);
    if ($subIds === []) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not resolve folder subtree']);

        return;
    }

    $storageRoot = $this->oaao_vault_storage_root();

    $db->beginTransaction();

    try {
        $paths = [];
        $q = $db->prepare()
            ->select('id, storage_path')
            ->from('vault_document')
            ->where('vault_id=:vid, container_id|=:cids')
            ->assign(['vid' => $vaultId, 'cids' => $subIds])
            ->query();
        while (($row = $q->fetch()) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $rel = isset($row['storage_path']) && \is_string($row['storage_path']) ? $row['storage_path'] : null;
            if ($rel !== null && $rel !== '') {
                $paths[] = $rel;
            }
        }

        $db->delete('vault_document', [
            'vault_id'      => $vaultId,
            'container_id'  => $subIds,
        ])->query();

        $db->delete('vault_container', [
            'vault_id' => $vaultId,
            'id'       => $subIds,
        ])->query();

        $db->commit();

        foreach ($paths as $rel) {
            $this->oaao_vault_unlink_storage_file($storageRoot, $rel);
        }

        echo json_encode(
            [
                'success' => true,
                'data'    => [
                    'vault_id'              => $vaultId,
                    'container_id'          => $containerId,
                    'deleted_container_ids' => $subIds,
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
            'message' => 'Could not delete folder',
            'data'    => ['detail' => $e->getMessage()],
        ]);
    }
};
