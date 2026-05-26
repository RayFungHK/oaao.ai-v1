<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchItemPurge;
use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/purge_orphans — remove unlinked vault files in a watch folder (refetch leftovers).
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
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
    $containerId = (int) ($watch['container_id'] ?? 0);
    if ($vaultId < 1 || $containerId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Watch has no vault folder']);

        return;
    }

    $dryRun = ! empty($input['dry_run']);
    if ($dryRun) {
        $orphans = ResearchItemPurge::listOrphanWatchDocumentIds($ctx['db'], $watchId, $vaultId, $containerId);
        echo json_encode([
            'success' => true,
            'dry_run' => true,
            'orphans_found' => \count($orphans),
            'document_ids' => $orphans,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $stats = ResearchItemPurge::purgeOrphanWatchDocuments($ctx['db'], $watchId, $vaultId, $containerId);

    echo json_encode([
        'success' => true,
        'purge'   => $stats,
        'message' => $stats['documents_removed'] > 0
            ? "Removed {$stats['documents_removed']} unlinked file(s) from the watch folder"
            : 'No unlinked files found in the watch folder',
    ], JSON_UNESCAPED_UNICODE);
};
