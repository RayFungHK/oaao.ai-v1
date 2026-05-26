<?php

declare(strict_types=1);

namespace oaaoai\research;

use Razy\Database;

/**
 * Vault folders/documents owned by Article Research — not deletable from Vault UI/API.
 */
final class ResearchVaultGuard
{
    public const FOLDER_PREFIX = 'Research / ';

    /**
     * @return list<int>
     */
    public static function researchRootContainerIds(Database $db, int $vaultId): array
    {
        if ($vaultId < 1) {
            return [];
        }

        $rows = $db->prepare()
            ->select('container_id')
            ->from('research_watch')
            ->where('vault_id=?,container_id IS NOT NULL')
            ->assign(['vault_id' => $vaultId])
            ->query()
            ->fetchAll();

        if (! \is_array($rows)) {
            return [];
        }

        /** @var list<int> $out */
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $cid = (int) ($row['container_id'] ?? 0);
            if ($cid > 0) {
                $out[] = $cid;
            }
        }

        return array_values(array_unique($out));
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return array{container_ids: array<int, true>, document_ids: array<int, true>}
     */
    public static function managedIdsForVaults(Database $db, array $vaultIds): array
    {
        $vaultIds = array_values(array_filter(array_map('intval', $vaultIds), static fn (int $id): bool => $id > 0));
        if ($vaultIds === []) {
            return ['container_ids' => [], 'document_ids' => []];
        }

        /** @var array<int, true> $containerIds */
        $containerIds = [];
        foreach ($vaultIds as $vaultId) {
            foreach (self::researchRootContainerIds($db, $vaultId) as $rootId) {
                foreach (self::containerSubtreeIds($db, $vaultId, $rootId) as $cid) {
                    $containerIds[$cid] = true;
                }
            }
        }

        /** @var array<int, true> $documentIds */
        $documentIds = [];
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $ph = implode(',', array_fill(0, \count($vaultIds), '?'));
            $sql = "SELECT i.document_id, i.summary_document_id
                    FROM oaao_research_item i
                    INNER JOIN oaao_research_watch w ON i.watch_id = w.watch_id
                    WHERE w.vault_id IN ({$ph})";
            $st = $pdo->prepare($sql);
            $st->execute($vaultIds);
            while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
                if (! \is_array($row)) {
                    continue;
                }
                foreach (['document_id', 'summary_document_id'] as $col) {
                    $did = (int) ($row[$col] ?? 0);
                    if ($did > 0) {
                        $documentIds[$did] = true;
                    }
                }
            }
        }

        return ['container_ids' => $containerIds, 'document_ids' => $documentIds];
    }

    public static function containerIsManaged(Database $db, int $vaultId, int $containerId): bool
    {
        if ($vaultId < 1 || $containerId < 1) {
            return false;
        }

        foreach (self::researchRootContainerIds($db, $vaultId) as $rootId) {
            $sub = self::containerSubtreeIds($db, $vaultId, $rootId);
            if (\in_array($containerId, $sub, true)) {
                return true;
            }
        }

        return false;
    }

    public static function documentIsManaged(Database $db, int $documentId): bool
    {
        if ($documentId < 1) {
            return false;
        }

        return self::documentIsLinked($db, $documentId);
    }

    public static function documentIsLinked(Database $db, int $documentId): bool
    {
        if ($documentId < 1) {
            return false;
        }

        foreach (['document_id', 'summary_document_id'] as $col) {
            $row = $db->prepare()
                ->select('item_id')
                ->from('research_item')
                ->where("{$col}=?", [$col => $documentId])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($row)) {
                return true;
            }
        }

        return false;
    }

    public static function vaultDeleteContainerMessage(): string
    {
        return 'This folder is managed by Article Research. Delete the watch from Research instead.';
    }

    public static function vaultDeleteDocumentMessage(): string
    {
        return 'This file is linked to an Article Research item. Refetch the article or remove the watch from Research.';
    }

    /**
     * @return list<int>
     */
    public static function containerSubtreeIds(Database $db, int $vaultId, int $rootContainerId): array
    {
        if ($vaultId < 1 || $rootContainerId < 1) {
            return [];
        }

        $sql = <<<'SQL'
WITH RECURSIVE sub AS (
    SELECT id FROM oaao_vault_container WHERE id = :rid AND vault_id = :v1
    UNION ALL
    SELECT c.id FROM oaao_vault_container c
    INNER JOIN sub s ON c.parent_container_id = s.id
    WHERE c.vault_id = :v2
)
SELECT id FROM sub
SQL;

        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return [];
        }

        $st = $pdo->prepare($sql);
        $st->execute([
            'rid' => $rootContainerId,
            'v1'  => $vaultId,
            'v2'  => $vaultId,
        ]);

        /** @var list<int> $out */
        $out = [];
        while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $id = (int) ($row['id'] ?? 0);
            if ($id > 0) {
                $out[] = $id;
            }
        }

        return $out;
    }

    public static function createResearchFolder(Database $db, int $vaultId, string $label, int $userId, ?int $parentContainerId = null, ?string $folderName = null): int
    {
        $custom = $folderName !== null ? trim($folderName) : '';
        if ($custom !== '') {
            $name = str_starts_with($custom, self::FOLDER_PREFIX) ? $custom : self::FOLDER_PREFIX . $custom;
        } else {
            $name = self::FOLDER_PREFIX . trim($label);
            if ($name === self::FOLDER_PREFIX) {
                $name = self::FOLDER_PREFIX . 'Watch';
            }
        }

        $ts = date('Y-m-d H:i:s');
        $db->insert('vault_container', ['vault_id', 'name', 'parent_container_id', 'created_by', 'created_at', 'updated_at'])
            ->assign([
                'vault_id'            => $vaultId,
                'name'                => $name,
                'parent_container_id' => $parentContainerId > 0 ? $parentContainerId : null,
                'created_by'          => $userId,
                'created_at'          => $ts,
                'updated_at'          => null,
            ])
            ->query();

        return (int) $db->lastID();
    }
}
