<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/AuthSchemaBridge.php';
require_once __DIR__ . '/AdjunctSqlite.php';
require_once __DIR__ . '/StorageSchemaEnsure.php';
require_once __DIR__ . '/StorageLocator.php';
require_once __DIR__ . '/StorageDomain.php';
require_once __DIR__ . '/TenantStorageConfig.php';
require_once __DIR__ . '/StorageOrchestratorClient.php';

/**
 * Enumerate tenant blobs and drive orchestrator migration batches.
 */
final class StorageMigrationRepository
{
    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    public static function enumeratePending(\PDO $pdo, int $tenantId, string $domain, int $limit = 100): array
    {
        AuthSchemaBridge::ensureTenantSchema($pdo);
        StorageSchemaEnsure::ensure($pdo);
        $limit = max(1, min(500, $limit));

        return match ($domain) {
            StorageDomain::VAULT => self::enumerateVault($pdo, $tenantId, $limit),
            StorageDomain::MINE => self::enumerateMine($pdo, $tenantId, $limit),
            StorageDomain::SLIDE_PROJECTS => self::enumerateSlideProjects($pdo, $tenantId, $limit),
            StorageDomain::CHAT_ATTACHMENTS => self::enumerateChatAttachments($pdo, $tenantId, $limit),
            StorageDomain::SLIDE_TEMPLATES => self::enumerateSlideTemplates($pdo, $tenantId, $limit),
            StorageDomain::AGENT_MATERIALS => self::enumerateAgentMaterials($pdo, $tenantId, $limit),
            default => [],
        };
    }

    /**
     * @param callable(int $offset, int $pageSize): list<array<string, mixed>> $fetchPage
     * @param callable(array<string, mixed>): ?StorageLocator $locatorFromRow
     * @param callable(array<string, mixed>, StorageLocator): array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string} $itemFromRow
     *
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function collectLocalPending(
        callable $fetchPage,
        callable $locatorFromRow,
        callable $itemFromRow,
        int $limit,
    ): array {
        /** @var list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}> $out */
        $out = [];
        $offset = 0;
        $pageSize = max($limit * 3, 50);

        while (\count($out) < $limit) {
            $rows = $fetchPage($offset, $pageSize);
            if ($rows === []) {
                break;
            }
            foreach ($rows as $row) {
                $loc = $locatorFromRow($row);
                if ($loc === null || ! $loc->isLocal()) {
                    continue;
                }
                $out[] = $itemFromRow($row, $loc);
                if (\count($out) >= $limit) {
                    break;
                }
            }
            if (\count($rows) < $pageSize) {
                break;
            }
            $offset += $pageSize;
        }

        return $out;
    }

    /** @return list<int> */
    private static function tenantUserIds(\PDO $pdo, int $tenantId): array
    {
        try {
            $st = $pdo->prepare('SELECT user_id FROM oaao_user WHERE tenant_id = ? AND disabled = 0 ORDER BY user_id ASC');
            $st->execute([$tenantId]);
        } catch (\Throwable) {
            return [];
        }

        /** @var list<int> $ids */
        $ids = [];
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            $uid = (int) ($row['user_id'] ?? 0);
            if ($uid > 0) {
                $ids[] = $uid;
            }
        }

        return $ids;
    }

    /** @return list<int> */
    private static function tenantWorkspaceIds(\PDO $pdo, int $tenantId): array
    {
        try {
            $st = $pdo->prepare('SELECT workspace_id FROM oaao_workspace WHERE tenant_id = ? AND disabled = 0 ORDER BY workspace_id ASC');
            $st->execute([$tenantId]);
        } catch (\Throwable) {
            return [];
        }

        /** @var list<int> $ids */
        $ids = [];
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            $wid = (int) ($row['workspace_id'] ?? 0);
            if ($wid > 0) {
                $ids[] = $wid;
            }
        }

        return $ids;
    }

    /**
     * @param list<int> $ids
     */
    private static function sqlInPlaceholders(array $ids): string
    {
        if ($ids === []) {
            return '0';
        }

        return implode(',', array_fill(0, \count($ids), '?'));
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateVault(\PDO $pdo, int $tenantId, int $limit): array
    {
        return self::collectLocalPending(
            static function (int $offset, int $pageSize) use ($pdo, $tenantId): array {
                $st = $pdo->prepare(
                    'SELECT d.id, d.storage_path, d.storage_locator_json, d.byte_size
                     FROM oaao_vault_document d
                     INNER JOIN oaao_vault v ON v.vault_id = d.vault_id
                     WHERE v.tenant_id = ? AND d.storage_path IS NOT NULL AND trim(d.storage_path) <> \'\'
                     ORDER BY d.id ASC
                     LIMIT ' . $pageSize . ' OFFSET ' . $offset,
                );
                $st->execute([$tenantId]);
                $rows = [];
                while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
                    $rows[] = $row;
                }

                return $rows;
            },
            static function (array $row): ?StorageLocator {
                return StorageLocator::fromRow(
                    isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : null,
                    isset($row['storage_path']) ? (string) $row['storage_path'] : null,
                    StorageDomain::VAULT,
                );
            },
            static function (array $row, StorageLocator $loc): array {
                return [
                    'object_id'   => 'vault_doc:' . (string) ($row['id'] ?? ''),
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => isset($row['byte_size']) ? (int) $row['byte_size'] : null,
                    'domain'      => StorageDomain::VAULT,
                ];
            },
            $limit,
        );
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateMine(\PDO $pdo, int $tenantId, int $limit): array
    {
        return self::collectLocalPending(
            static function (int $offset, int $pageSize) use ($pdo, $tenantId): array {
                try {
                    $st = $pdo->prepare(
                        'SELECT mine_id, sqlite_path, storage_locator_json FROM oaao_mine
                         WHERE tenant_id = ? AND sqlite_path IS NOT NULL
                         ORDER BY mine_id ASC LIMIT ' . $pageSize . ' OFFSET ' . $offset,
                    );
                    $st->execute([$tenantId]);
                } catch (\Throwable) {
                    return [];
                }
                $rows = [];
                while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
                    $rows[] = $row;
                }

                return $rows;
            },
            static function (array $row): ?StorageLocator {
                $rel = (string) ($row['sqlite_path'] ?? '');

                return StorageLocator::fromRow(
                    isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : null,
                    $rel,
                    StorageDomain::MINE,
                );
            },
            static function (array $row, StorageLocator $loc): array {
                return [
                    'object_id'   => 'mine:' . (string) ($row['mine_id'] ?? ''),
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => null,
                    'domain'      => StorageDomain::MINE,
                ];
            },
            $limit,
        );
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateSlideProjects(\PDO $pdo, int $tenantId, int $limit): array
    {
        $adj = AdjunctSqlite::openPdo();
        if ($adj === null) {
            return [];
        }

        $userIds = self::tenantUserIds($pdo, $tenantId);
        if ($userIds === []) {
            return [];
        }

        require_once dirname(__DIR__, 3) . '/slide-designer/default/library/SlideProjectStorage.php';

        $inUsers = self::sqlInPlaceholders($userIds);

        return self::collectLocalPending(
            static function (int $offset, int $pageSize) use ($adj, $userIds, $inUsers): array {
                $st = $adj->prepare(
                    'SELECT project_id, root_path, storage_locator_json, user_id
                     FROM oaao_slide_project
                     WHERE user_id IN (' . $inUsers . ')
                     ORDER BY created_at ASC
                     LIMIT ' . $pageSize . ' OFFSET ' . $offset,
                );
                $st->execute($userIds);
                $rows = [];
                while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
                    $rows[] = $row;
                }

                return $rows;
            },
            static function (array $row): ?StorageLocator {
                $projectId = trim((string) ($row['project_id'] ?? ''));
                if ($projectId === '') {
                    return null;
                }
                $json = isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : null;
                if ($json !== null && trim($json) !== '') {
                    $parsed = StorageLocator::decodeJson($json);
                    if ($parsed !== null) {
                        return $parsed;
                    }
                }
                $manifest = \oaaoai\slide_designer\SlideProjectStorage::manifestPath($projectId);
                if (! is_file($manifest)) {
                    return null;
                }

                return new StorageLocator(
                    StorageLocator::BACKEND_LOCAL,
                    'projects/' . $projectId . '/project.json',
                    null,
                    null,
                    null,
                    (int) @filesize($manifest),
                    \oaaoai\slide_designer\SlideProjectStorage::root(),
                );
            },
            static function (array $row, StorageLocator $loc): array {
                return [
                    'object_id'   => 'slide:' . (string) ($row['project_id'] ?? ''),
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => null,
                    'domain'      => StorageDomain::SLIDE_PROJECTS,
                ];
            },
            $limit,
        );
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateChatAttachments(\PDO $pdo, int $tenantId, int $limit): array
    {
        $adj = AdjunctSqlite::openPdo();
        if ($adj === null) {
            return [];
        }

        $userIds = self::tenantUserIds($pdo, $tenantId);
        $workspaceIds = self::tenantWorkspaceIds($pdo, $tenantId);
        if ($userIds === []) {
            return [];
        }

        require_once dirname(__DIR__, 3) . '/chat/default/library/ChatAttachmentStorage.php';

        $inUsers = self::sqlInPlaceholders($userIds);
        $workspaceClause = $workspaceIds !== []
            ? '(c.workspace_id IN (' . self::sqlInPlaceholders($workspaceIds) . ') OR (c.workspace_id IS NULL AND c.user_id IN (' . $inUsers . ')))'
            : '(c.workspace_id IS NULL AND c.user_id IN (' . $inUsers . '))';

        return self::collectLocalPending(
            static function (int $offset, int $pageSize) use ($adj, $userIds, $workspaceIds, $inUsers, $workspaceClause): array {
                /** @var list<int|string> $params */
                $params = array_merge($userIds, $workspaceIds, $userIds);
                $sql = 'SELECT a.id, a.conversation_id, a.user_id, a.storage_path, a.storage_locator_json, a.byte_size
                        FROM oaao_conversation_attachment a
                        LEFT JOIN oaao_conversation c ON c.id = a.conversation_id AND a.conversation_id > 0
                        WHERE a.storage_path IS NOT NULL AND trim(a.storage_path) <> \'\'
                          AND (
                            (a.conversation_id = 0 AND a.user_id IN (' . $inUsers . '))
                            OR (a.conversation_id > 0 AND c.id IS NOT NULL AND ' . $workspaceClause . ')
                          )
                        ORDER BY a.id ASC
                        LIMIT ' . $pageSize . ' OFFSET ' . $offset;
                $st = $adj->prepare($sql);
                $st->execute($params);
                $rows = [];
                while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
                    $rows[] = $row;
                }

                return $rows;
            },
            static function (array $row): ?StorageLocator {
                $json = isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : null;
                if ($json !== null && trim($json) !== '') {
                    $parsed = StorageLocator::decodeJson($json);
                    if ($parsed !== null) {
                        return $parsed;
                    }
                }
                $cid = (int) ($row['conversation_id'] ?? 0);
                $uid = (int) ($row['user_id'] ?? 0);
                $stored = trim((string) ($row['storage_path'] ?? ''));
                if ($stored === '') {
                    return null;
                }
                $draft = $cid < 1;
                $relKey = \oaaoai\chat\ChatAttachmentStorage::relativeKey($cid, $uid, $stored, $draft);

                return new StorageLocator(
                    StorageLocator::BACKEND_LOCAL,
                    $relKey,
                    null,
                    null,
                    null,
                    isset($row['byte_size']) ? (int) $row['byte_size'] : null,
                    StorageDomain::defaultLocalRoot(StorageDomain::CHAT_ATTACHMENTS),
                );
            },
            static function (array $row, StorageLocator $loc): array {
                return [
                    'object_id'   => 'chat_attach:' . (string) ($row['id'] ?? ''),
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => isset($row['byte_size']) ? (int) $row['byte_size'] : null,
                    'domain'      => StorageDomain::CHAT_ATTACHMENTS,
                ];
            },
            $limit,
        );
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateAgentMaterials(\PDO $pdo, int $tenantId, int $limit): array
    {
        $adj = AdjunctSqlite::openPdo();
        if ($adj === null) {
            return [];
        }

        $userIds = self::tenantUserIds($pdo, $tenantId);
        if ($userIds === []) {
            return [];
        }

        $inUsers = self::sqlInPlaceholders($userIds);

        return self::collectLocalPending(
            static function (int $offset, int $pageSize) use ($adj, $userIds, $inUsers): array {
                $st = $adj->prepare(
                    'SELECT m.id, m.conversation_id, m.material_id, m.storage_locator_json, m.byte_size
                     FROM oaao_conversation_material m
                     INNER JOIN oaao_conversation c ON c.id = m.conversation_id
                     WHERE c.user_id IN (' . $inUsers . ')
                       AND m.storage_locator_json IS NOT NULL AND trim(m.storage_locator_json) <> \'\'
                     ORDER BY m.id ASC
                     LIMIT ' . $pageSize . ' OFFSET ' . $offset,
                );
                $st->execute($userIds);
                $rows = [];
                while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
                    $rows[] = $row;
                }

                return $rows;
            },
            static function (array $row): ?StorageLocator {
                return StorageLocator::decodeJson(
                    isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : null,
                );
            },
            static function (array $row, StorageLocator $loc): array {
                return [
                    'object_id'   => 'agent_mat:' . (string) ($row['id'] ?? ''),
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => isset($row['byte_size']) ? (int) $row['byte_size'] : null,
                    'domain'      => StorageDomain::AGENT_MATERIALS,
                ];
            },
            $limit,
        );
    }

    /**
     * @return list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}>
     */
    private static function enumerateSlideTemplates(\PDO $pdo, int $tenantId, int $limit): array
    {
        $root = StorageDomain::defaultLocalRoot(StorageDomain::SLIDE_TEMPLATES);
        /** @var list<string> $scanRoots */
        $scanRoots = [$root . '/tenant/' . max(1, $tenantId)];
        foreach (self::tenantUserIds($pdo, $tenantId) as $uid) {
            $scanRoots[] = $root . '/personal/' . $uid;
        }

        /** @var list<array{object_id: string, src_locator: array<string, mixed>, byte_size: int|null, domain: string}> $out */
        $out = [];
        $rootLen = \strlen(rtrim($root, '/\\')) + 1;

        foreach ($scanRoots as $base) {
            if (! is_dir($base)) {
                continue;
            }
            try {
                $iter = new \RecursiveIteratorIterator(
                    new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
                );
            } catch (\Throwable) {
                continue;
            }
            foreach ($iter as $file) {
                if (! $file->isFile()) {
                    continue;
                }
                $abs = $file->getPathname();
                $rel = ltrim(str_replace('\\', '/', substr($abs, $rootLen)), '/');
                if ($rel === '' || str_contains($rel, '..')) {
                    continue;
                }
                $loc = new StorageLocator(
                    StorageLocator::BACKEND_LOCAL,
                    $rel,
                    null,
                    null,
                    null,
                    (int) $file->getSize(),
                    $root,
                );
                $out[] = [
                    'object_id'   => 'slide_tpl:' . $rel,
                    'src_locator' => $loc->toArray(),
                    'byte_size'   => (int) $file->getSize(),
                    'domain'      => StorageDomain::SLIDE_TEMPLATES,
                ];
                if (\count($out) >= $limit) {
                    return $out;
                }
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $dstLocator
     */
    public static function recordItem(
        \PDO $pdo,
        int $tenantId,
        string $domain,
        string $objectId,
        string $srcJson,
        ?string $dstJson,
        string $status,
        ?string $error = null,
        ?int $byteSize = null,
    ): void {
        $pdo->prepare(
            'INSERT INTO oaao_storage_migration_item
             (tenant_id, domain, object_id, src_locator_json, dst_locator_json, status, error_text, byte_size, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        )->execute([$tenantId, $domain, $objectId, $srcJson, $dstJson, $status, $error, $byteSize]);
    }

    /**
     * @return array{total: int, done: int, failed: int}
     */
    public static function migrationCounts(\PDO $pdo, int $tenantId): array
    {
        $st = $pdo->prepare(
            'SELECT status, COUNT(*) AS c FROM oaao_storage_migration_item WHERE tenant_id = ? GROUP BY status',
        );
        $st->execute([$tenantId]);
        $done = 0;
        $failed = 0;
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            $status = (string) ($row['status'] ?? '');
            $c = (int) ($row['c'] ?? 0);
            if ($status === 'completed') {
                $done += $c;
            } elseif ($status === 'failed') {
                $failed += $c;
            }
        }

        return ['total' => $done + $failed, 'done' => $done, 'failed' => $failed];
    }

    public static function applyVaultLocator(\PDO $pdo, int $documentId, StorageLocator $locator): void
    {
        $pdo->prepare(
            'UPDATE oaao_vault_document SET storage_locator_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        )->execute([$locator->toJson(), $documentId]);
    }

    public static function applyMineLocator(\PDO $pdo, int $mineId, StorageLocator $locator): void
    {
        $pdo->prepare(
            'UPDATE oaao_mine SET storage_locator_json = ?, updated_at = CURRENT_TIMESTAMP WHERE mine_id = ?',
        )->execute([$locator->toJson(), $mineId]);
    }

    public static function applySlideProjectLocator(\PDO $adjunctPdo, string $projectId, StorageLocator $locator): void
    {
        if ($projectId === '') {
            return;
        }
        $adjunctPdo->prepare(
            'UPDATE oaao_slide_project SET storage_locator_json = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?',
        )->execute([$locator->toJson(), $projectId]);
    }

    public static function applyChatAttachmentLocator(\PDO $adjunctPdo, int $attachmentId, StorageLocator $locator): void
    {
        if ($attachmentId < 1) {
            return;
        }
        $adjunctPdo->prepare(
            'UPDATE oaao_conversation_attachment SET storage_locator_json = ? WHERE id = ?',
        )->execute([$locator->toJson(), $attachmentId]);
    }

    public static function applyAgentMaterialLocator(\PDO $adjunctPdo, int $materialRowId, StorageLocator $locator): void
    {
        if ($materialRowId < 1) {
            return;
        }
        $adjunctPdo->prepare(
            'UPDATE oaao_conversation_material SET storage_locator_json = ? WHERE id = ?',
        )->execute([$locator->toJson(), $materialRowId]);
    }
}
