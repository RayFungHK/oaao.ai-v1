<?php

declare(strict_types=1);

namespace oaaoai\mine;

require_once __DIR__ . '/_bootstrap.php';
require_once dirname(__DIR__, 3) . '/core/default/library/TenantBlobStorage.php';
require_once dirname(__DIR__, 3) . '/core/default/library/StorageDomain.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/** Sync mine SQLite files to tenant object storage. */
final class MineBlobSync
{
    public static function flushSqlite(\PDO $pdo, int $tenantId, int $mineId, string $relativePath): ?string
    {
        if ($tenantId < 1 || $mineId < 1 || trim($relativePath) === '') {
            return null;
        }

        $abs = MineStorage::absPath($relativePath);
        if ($abs === '' || ! is_file($abs)) {
            return null;
        }

        $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::MINE);
        $locator = $blob->putUploadedFile($abs, $relativePath);
        $pdo->prepare(
            'UPDATE oaao_mine SET storage_locator_json = ?, updated_at = CURRENT_TIMESTAMP WHERE mine_id = ?',
        )->execute([$locator->toJson(), $mineId]);

        return $locator->toJson();
    }

    public static function resolveAbsPath(\PDO $pdo, int $tenantId, ?string $locatorJson, string $relativePath): string
    {
        if ($tenantId > 0 && $locatorJson !== null && trim($locatorJson) !== '') {
            try {
                $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::MINE);

                return $blob->resolveAbsolutePath($locatorJson, $relativePath, oaao_mine_data_root());
            } catch (\Throwable) {
            }
        }

        return MineStorage::absPath($relativePath);
    }
}
