<?php

declare(strict_types=1);

require_once __DIR__ . '/_storage_admin.php';
require_once __DIR__ . '/../../library/TenantStorageConfig.php';
require_once __DIR__ . '/../../library/StorageDomain.php';
require_once __DIR__ . '/../../library/StorageMigrationRepository.php';
require_once __DIR__ . '/../../library/StorageLocator.php';
require_once __DIR__ . '/../../library/AdjunctSqlite.php';
require_once __DIR__ . '/../../library/StorageOrchestratorClient.php';

use Oaaoai\Core\AdjunctSqlite;
use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageLocator;
use Oaaoai\Core\StorageMigrationRepository;
use Oaaoai\Core\StorageOrchestratorClient;
use Oaaoai\Core\TenantStorageConfig;

/**
 * POST /api/storage_migrate — run one migration batch per domain.
 */
return function (): void {
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? '')) !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_core_storage_require_admin($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $domain = isset($input['domain']) ? trim((string) $input['domain']) : StorageDomain::VAULT;
    if (! StorageDomain::isValid($domain)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid domain']);

        return;
    }

    $pdo = $ctx['pdo'];
    $tenantId = $ctx['tenant_id'];
    $config = TenantStorageConfig::load($pdo, $tenantId);
    $srcCfg = TenantStorageConfig::migrationSourceConfig($config, $domain);
    $dstCfg = TenantStorageConfig::migrationTargetConfig($config, $domain);
    if (isset($input['target_provider_id']) && \is_string($input['target_provider_id'])) {
        $targetPid = trim($input['target_provider_id']);
        if ($targetPid !== '') {
            $migrationTargetPatch = ['migration' => ['target_provider_id' => $targetPid]];
            $config = TenantStorageConfig::mergeConfig($config, $migrationTargetPatch);
            $dstCfg = TenantStorageConfig::migrationTargetConfig($config, $domain);
        }
    }
    if (isset($input['source_provider_id']) && \is_string($input['source_provider_id'])) {
        $sourcePid = trim($input['source_provider_id']);
        $config = TenantStorageConfig::mergeConfig($config, [
            'migration' => ['source_provider_id' => $sourcePid],
        ]);
        $srcCfg = TenantStorageConfig::migrationSourceConfig($config, $domain);
    }

    $err = TenantStorageConfig::validateDomainConfig($dstCfg);
    if ($err !== null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $err]);

        return;
    }

    $migration = \is_array($config['migration'] ?? null) ? $config['migration'] : [];
    $purgeSource = isset($input['purge_source'])
        ? filter_var($input['purge_source'], FILTER_VALIDATE_BOOLEAN)
        : filter_var($migration['purge_source'] ?? true, FILTER_VALIDATE_BOOLEAN);

    $migrationPatch = [
        'migration' => [
            'status'       => 'running',
            'from_backend' => $srcCfg['backend'] ?? 'local',
            'to_backend'   => $dstCfg['backend'] ?? 'local',
            'purge_source' => $purgeSource,
        ],
    ];
    TenantStorageConfig::save($pdo, $tenantId, $migrationPatch);

    $batch = StorageMigrationRepository::enumeratePending($pdo, $tenantId, $domain, 50);
    $items = [];
    foreach ($batch as $row) {
        $items[] = [
            'object_id'   => $row['object_id'],
            'src_locator' => $row['src_locator'],
        ];
    }

    $resp = StorageOrchestratorClient::post('migrate-batch', [
        'tenant_id'          => $tenantId,
        'domain'             => $domain,
        'src_domain_config'  => $srcCfg,
        'dst_domain_config'  => $dstCfg,
        'items'              => $items,
        'purge_source'       => $purgeSource,
    ], 600);

    $results = \is_array($resp['results'] ?? null) ? $resp['results'] : [];
    foreach ($results as $idx => $result) {
        if (! \is_array($result)) {
            continue;
        }
        $srcItem = $batch[$idx] ?? null;
        if ($srcItem === null) {
            continue;
        }
        $objectId = (string) ($result['object_id'] ?? $srcItem['object_id']);
        $srcJson = json_encode($srcItem['src_locator'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (! empty($result['ok']) && isset($result['dst_locator']) && \is_array($result['dst_locator'])) {
            $dstLoc = StorageLocator::decodeJson(json_encode($result['dst_locator'], JSON_THROW_ON_ERROR));
            $dstJson = $dstLoc ? $dstLoc->toJson() : null;
            StorageMigrationRepository::recordItem(
                $pdo,
                $tenantId,
                $domain,
                $objectId,
                $srcJson,
                $dstJson,
                'completed',
                null,
                isset($result['byte_size']) ? (int) $result['byte_size'] : null,
            );
            if ($dstLoc !== null) {
                self_apply_locator($pdo, $domain, $objectId, $dstLoc);
            }
        } else {
            StorageMigrationRepository::recordItem(
                $pdo,
                $tenantId,
                $domain,
                $objectId,
                $srcJson,
                null,
                'failed',
                isset($result['error']) ? (string) $result['error'] : 'migrate failed',
            );
        }
    }

    $counts = StorageMigrationRepository::migrationCounts($pdo, $tenantId);
    $status = ($counts['failed'] > 0 && $counts['done'] === 0) ? 'failed' : 'running';
    if ($items === []) {
        $status = 'completed';
    }
    TenantStorageConfig::save($pdo, $tenantId, [
        'migration' => array_merge($migrationPatch['migration'], [
            'progress'            => $counts,
            'status'              => $status,
            'source_provider_id'  => isset($input['source_provider_id']) ? trim((string) $input['source_provider_id']) : ($migration['source_provider_id'] ?? ''),
            'target_provider_id'  => isset($input['target_provider_id']) ? trim((string) $input['target_provider_id']) : ($migration['target_provider_id'] ?? ''),
        ]),
    ]);

    echo json_encode([
        'success' => true,
        'data'    => [
            'batch_size' => count($items),
            'results'    => $results,
            'progress'   => $counts,
            'status'     => $status,
        ],
    ], JSON_UNESCAPED_UNICODE);
};

/**
 * @internal
 */
function self_apply_locator(\PDO $pdo, string $domain, string $objectId, StorageLocator $locator): void
{
    if (str_starts_with($objectId, 'vault_doc:')) {
        $docId = (int) substr($objectId, strlen('vault_doc:'));
        if ($docId > 0) {
            StorageMigrationRepository::applyVaultLocator($pdo, $docId, $locator);
        }

        return;
    }
    if (str_starts_with($objectId, 'mine:')) {
        $mineId = (int) substr($objectId, strlen('mine:'));
        if ($mineId > 0) {
            StorageMigrationRepository::applyMineLocator($pdo, $mineId, $locator);
        }

        return;
    }
    if (str_starts_with($objectId, 'slide:')) {
        $projectId = substr($objectId, strlen('slide:'));
        $adj = AdjunctSqlite::openPdo();
        if ($adj !== null && $projectId !== '') {
            StorageMigrationRepository::applySlideProjectLocator($adj, $projectId, $locator);
        }

        return;
    }
    if (str_starts_with($objectId, 'chat_attach:')) {
        $attachmentId = (int) substr($objectId, strlen('chat_attach:'));
        $adj = AdjunctSqlite::openPdo();
        if ($adj !== null && $attachmentId > 0) {
            StorageMigrationRepository::applyChatAttachmentLocator($adj, $attachmentId, $locator);
        }

        return;
    }
    if (str_starts_with($objectId, 'agent_mat:')) {
        $materialRowId = (int) substr($objectId, strlen('agent_mat:'));
        $adj = AdjunctSqlite::openPdo();
        if ($adj !== null && $materialRowId > 0) {
            StorageMigrationRepository::applyAgentMaterialLocator($adj, $materialRowId, $locator);
        }

        return;
    }
    // slide_tpl:* — filesystem-only; purge_source removes local copy; no row to update.
}
