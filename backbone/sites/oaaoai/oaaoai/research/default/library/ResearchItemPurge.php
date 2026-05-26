<?php

declare(strict_types=1);

namespace oaaoai\research;

use oaaoai\vault\VaultQdrantPoints;
use Razy\Database;

/**
 * Remove Research-managed vault markdown, summaries, and vector embeddings before refetch.
 */
final class ResearchItemPurge
{
    /**
     * @return array{documents_removed: int, items_reset: int, document_ids: list<int>}
     */
    public static function purgeWatchStoredArtifacts(Database $db, int $watchId, int $vaultId): array
    {
        if ($watchId < 1 || $vaultId < 1) {
            return ['documents_removed' => 0, 'items_reset' => 0, 'document_ids' => []];
        }

        $repo = new ResearchRepository($db);
        $docIds = $repo->listItemDocumentIds($watchId);
        $storageRoot = oaao_research_vault_storage_root();
        $removed = 0;

        foreach ($docIds as $docId) {
            if (self::purgeVaultDocument($db, $vaultId, $docId, $storageRoot)) {
                $removed++;
            }
        }

        $itemsReset = $repo->clearItemStoredArtifacts($watchId);

        return [
            'documents_removed' => $removed,
            'items_reset'       => $itemsReset,
            'document_ids'      => $docIds,
        ];
    }

    public static function purgeVaultDocument(Database $db, int $vaultId, int $documentId, string $storageRoot): bool
    {
        if ($vaultId < 1 || $documentId < 1) {
            return false;
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('id, vault_id, storage_path')
            ->from('vault_document')
            ->where('id=?')
            ->assign(['id' => $documentId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($row === false || ! \is_array($row)) {
            return false;
        }
        if ((int) ($row['vault_id'] ?? 0) !== $vaultId) {
            return false;
        }

        self::cancelActiveEmbedJobs($db, $documentId);
        self::deleteQdrantEmbeddings($db, $vaultId, $documentId);

        $relPath = isset($row['storage_path']) && \is_string($row['storage_path']) ? $row['storage_path'] : null;
        $db->delete('vault_document', ['id' => $documentId])->query();
        oaao_research_unlink_storage_file($storageRoot, $relPath);

        return true;
    }

    private static function cancelActiveEmbedJobs(Database $db, int $documentId): void
    {
        if ($documentId < 1) {
            return;
        }
        $ts = gmdate('Y-m-d H:i:s');
        $db->update('vault_job', ['status', 'finished_at', 'last_error', 'updated_at'])
            ->where('document_id=:doc_id, hook_id=:hook_id, status|=:st')
            ->assign([
                'status'      => 'failed',
                'finished_at' => $ts,
                'last_error'  => 'purged_by_research_refetch',
                'updated_at'  => $ts,
                'doc_id'      => $documentId,
                'hook_id'     => 'vh.rag.document_embed',
                'st'          => ['queued', 'running'],
            ])
            ->query();
    }

    private static function deleteQdrantEmbeddings(Database $db, int $vaultId, int $documentId): void
    {
        if ($vaultId < 1 || $documentId < 1) {
            return;
        }

        /** @var array<string, mixed>|false $vr */
        $vr = $db->prepare()
            ->select('id, scope, workspace_id, owner_user_id, qdrant_url, qdrant_collection, qdrant_api_key_ref')
            ->from('vault')
            ->where('id=:vid')
            ->assign(['vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($vr)) {
            return;
        }

        VaultQdrantPoints::deleteEmbeddingsForDocument($vr, $vaultId, $documentId);
    }

    /**
     * Purge vault files + embeddings for one research_item before refetch.
     *
     * @return array{documents_removed: int, document_ids: list<int>}
     */
    public static function purgeResearchItem(Database $db, int $itemId, int $vaultId): array
    {
        if ($itemId < 1 || $vaultId < 1) {
            return ['documents_removed' => 0, 'document_ids' => []];
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('document_id,summary_document_id')
            ->from('research_item')
            ->where('item_id=?')
            ->assign(['item_id' => $itemId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($row === false || ! \is_array($row)) {
            return ['documents_removed' => 0, 'document_ids' => []];
        }

        $storageRoot = oaao_research_vault_storage_root();
        $removed = 0;
        /** @var list<int> $docIds */
        $docIds = [];
        foreach (['document_id', 'summary_document_id'] as $col) {
            $did = (int) ($row[$col] ?? 0);
            if ($did > 0) {
                $docIds[] = $did;
            }
        }
        $docIds = array_values(array_unique($docIds));

        foreach ($docIds as $docId) {
            if (self::purgeVaultDocument($db, $vaultId, $docId, $storageRoot)) {
                $removed++;
            }
        }

        (new ResearchRepository($db))->clearItemArtifactLinks($itemId);

        return ['documents_removed' => $removed, 'document_ids' => $docIds];
    }

    /**
     * Vault files in a watch folder tree that are no longer linked on any research_item row.
     *
     * @return list<int>
     */
    public static function listOrphanWatchDocumentIds(Database $db, int $watchId, int $vaultId, int $containerId): array
    {
        if ($watchId < 1 || $vaultId < 1 || $containerId < 1) {
            return [];
        }

        $linked = array_fill_keys((new ResearchRepository($db))->listItemDocumentIds($watchId), true);
        $containerIds = ResearchVaultGuard::containerSubtreeIds($db, $vaultId, $containerId);
        if ($containerIds === []) {
            return [];
        }

        $pdo = $db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return [];
        }

        $ph = implode(',', array_fill(0, \count($containerIds), '?'));
        $sql = "SELECT id FROM oaao_vault_document
                WHERE vault_id = ?
                  AND container_id IN ({$ph})";
        $st = $pdo->prepare($sql);
        $st->execute(array_merge([$vaultId], $containerIds));

        /** @var list<int> $orphans */
        $orphans = [];
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $did = (int) ($row['id'] ?? 0);
            if ($did > 0 && ! isset($linked[$did])) {
                $orphans[] = $did;
            }
        }

        return $orphans;
    }

    /**
     * @return array{documents_removed: int, document_ids: list<int>, orphans_found: int}
     */
    public static function purgeOrphanWatchDocuments(Database $db, int $watchId, int $vaultId, int $containerId): array
    {
        $orphans = self::listOrphanWatchDocumentIds($db, $watchId, $vaultId, $containerId);
        if ($orphans === []) {
            return ['documents_removed' => 0, 'document_ids' => [], 'orphans_found' => 0];
        }

        $storageRoot = oaao_research_vault_storage_root();
        $removed = 0;
        foreach ($orphans as $docId) {
            if (self::purgeVaultDocument($db, $vaultId, $docId, $storageRoot)) {
                $removed++;
            }
        }

        return [
            'documents_removed' => $removed,
            'document_ids'      => $orphans,
            'orphans_found'     => \count($orphans),
        ];
    }
}
