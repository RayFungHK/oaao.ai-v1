<?php

declare(strict_types=1);

require_once __DIR__ . '/_storage_admin.php';
require_once __DIR__ . '/../../library/TenantStorageConfig.php';
require_once __DIR__ . '/../../library/StorageMigrationRepository.php';

use Oaaoai\Core\StorageMigrationRepository;
use Oaaoai\Core\TenantStorageConfig;

/**
 * GET /api/storage_migrate_status — migration progress for current tenant.
 */
return function (): void {
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? '')) !== 'GET') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_core_storage_require_admin($this);
    if ($ctx === null) {
        return;
    }

    $config = TenantStorageConfig::load($ctx['pdo'], $ctx['tenant_id']);
    $counts = StorageMigrationRepository::migrationCounts($ctx['pdo'], $ctx['tenant_id']);
    $migration = \is_array($config['migration'] ?? null) ? $config['migration'] : [];
    $migration['progress'] = $counts;

    echo json_encode([
        'success' => true,
        'data'    => [
            'migration' => $migration,
            'config'    => TenantStorageConfig::publicPayload($config),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
