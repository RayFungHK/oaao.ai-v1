<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;
use oaaoai\research\ResearchVaultGuard;

/**
 * POST /research/api/watch_delete — remove watch and its Research-managed vault folder + files.
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    if ($watchId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id required']);

        return;
    }

    $repo = new ResearchRepository($ctx['db']);
    $watch = $repo->getWatch($watchId, $ctx['tenant_id'], $ctx['uid']);
    if ($watch === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Watch not found']);

        return;
    }

    $vaultId = (int) ($watch['vault_id'] ?? 0);
    $containerId = isset($watch['container_id']) && $watch['container_id'] !== null
        ? (int) $watch['container_id']
        : 0;

    $db = $ctx['db'];
    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $storageRoot = oaao_research_vault_storage_root();

    $db->beginTransaction();

    try {
        if ($vaultId > 0 && $containerId > 0) {
            $subIds = ResearchVaultGuard::containerSubtreeIds($db, $vaultId, $containerId);
            if ($subIds !== []) {
                $paths = [];
                $ph = implode(',', array_fill(0, \count($subIds), '?'));
                $sel = $pdo->prepare(
                    "SELECT storage_path FROM oaao_vault_document
                     WHERE vault_id = ? AND container_id IN ({$ph})",
                );
                $sel->execute(array_merge([$vaultId], $subIds));
                while (($row = $sel->fetch(\PDO::FETCH_ASSOC)) !== false) {
                    if (! \is_array($row)) {
                        continue;
                    }
                    $rel = isset($row['storage_path']) && \is_string($row['storage_path']) ? $row['storage_path'] : null;
                    if ($rel !== null && $rel !== '') {
                        $paths[] = $rel;
                    }
                }

                $delDocs = $pdo->prepare(
                    "DELETE FROM oaao_vault_document
                     WHERE vault_id = ? AND container_id IN ({$ph})",
                );
                $delDocs->execute(array_merge([$vaultId], $subIds));

                $delContainers = $pdo->prepare(
                    "DELETE FROM oaao_vault_container
                     WHERE vault_id = ? AND id IN ({$ph})",
                );
                $delContainers->execute(array_merge([$vaultId], $subIds));

                foreach ($paths as $rel) {
                    oaao_research_unlink_storage_file($storageRoot, $rel);
                }
            }
        }

        $delWatch = $pdo->prepare('DELETE FROM oaao_research_watch WHERE watch_id = ?');
        $delWatch->execute([$watchId]);

        $db->commit();
    } catch (\Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollback();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not delete watch',
            'data'    => ['detail' => $e->getMessage()],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
