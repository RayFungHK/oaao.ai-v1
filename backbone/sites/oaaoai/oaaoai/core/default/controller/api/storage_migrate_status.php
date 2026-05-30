<?php

declare(strict_types=1);

require_once __DIR__ . '/../../library/AdjunctSqlite.php';
require_once __DIR__ . '/_storage_admin.php';
require_once __DIR__ . '/../../library/TenantStorageConfig.php';
require_once __DIR__ . '/../../library/StorageMigrationRepository.php';

use Oaaoai\Core\AdjunctSqlite;
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

    $adj = AdjunctSqlite::openPdo();
    if ($adj instanceof \PDO) {
        $chat = $this->api('chat');
        if ($chat) {
            $chat->ensureConversationAttachmentSchema($adj);
            $chat->ensureConversationMaterialSchema($adj);
        }
        $slide = $this->api('slide_designer');
        if ($slide) {
            $slide->ensureSlideProjectSchema($adj);
        }
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
