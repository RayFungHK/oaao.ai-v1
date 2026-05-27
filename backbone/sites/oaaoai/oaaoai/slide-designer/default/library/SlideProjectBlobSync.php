<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

require_once dirname(__DIR__, 3) . '/core/default/library/TenantBlobStorage.php';
require_once dirname(__DIR__, 3) . '/core/default/library/StorageDomain.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/** Sync slide project trees to tenant object storage on checkpoint. */
final class SlideProjectBlobSync
{
    public static function flushProject(\PDO $pdo, int $tenantId, string $projectId): ?string
    {
        if ($tenantId < 1 || trim($projectId) === '') {
            return null;
        }

        $manifestPath = SlideProjectStorage::manifestPath($projectId);
        if (! is_file($manifestPath)) {
            return null;
        }

        $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::SLIDE_PROJECTS);
        $rel = 'projects/' . $projectId . '/project.json';
        $content = file_get_contents($manifestPath);
        if ($content === false) {
            return null;
        }

        $locator = $blob->putContent($content, $rel);
        $pdo->prepare(
            'UPDATE oaao_slide_project SET storage_locator_json = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?',
        )->execute([$locator->toJson(), $projectId]);

        return $locator->toJson();
    }

    public static function hydrateManifest(\PDO $pdo, int $tenantId, string $projectId): bool
    {
        $st = $pdo->prepare(
            'SELECT storage_locator_json, root_path FROM oaao_slide_project WHERE project_id = ? LIMIT 1',
        );
        $st->execute([$projectId]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);
        if ($row === false) {
            return false;
        }

        $locatorJson = isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : '';
        if ($locatorJson === '') {
            return is_file(SlideProjectStorage::manifestPath($projectId));
        }

        $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::SLIDE_PROJECTS);
        try {
            $abs = $blob->resolveAbsolutePath($locatorJson, 'projects/' . $projectId . '/project.json', SlideProjectStorage::root());
            $dest = SlideProjectStorage::manifestPath($projectId);
            if (! is_dir(dirname($dest))) {
                mkdir(dirname($dest), 0775, true);
            }

            return copy($abs, $dest);
        } catch (\Throwable) {
            return false;
        }
    }
}
