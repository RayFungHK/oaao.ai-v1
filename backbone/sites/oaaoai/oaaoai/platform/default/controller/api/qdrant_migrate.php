<?php

declare(strict_types=1);

use Oaaoai\Core\QdrantCollectionMigrator;
use Oaaoai\Core\TenantRepository;

/**
 * POST /platform/api/qdrant_migrate — copy Qdrant collections from legacy slug prefix to tenant slug.
 *
 * JSON: {@code tenant_id}, {@code from_slug?} (default {@code web}), {@code delete_source?} (bool).
 */
return function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $db = $this->oaao_platform_require_pg();
    if ($db === null) {
        return;
    }

    $raw = file_get_contents('php://input');
    /** @var array<string, mixed> $body */
    $body = [];
    if (\is_string($raw) && trim($raw) !== '') {
        $dec = json_decode($raw, true);
        if (\is_array($dec)) {
            $body = $dec;
        }
    }

    $tenantId = isset($body['tenant_id']) ? (int) $body['tenant_id'] : 0;
    if ($tenantId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'tenant_id required']);

        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $tenant = TenantRepository::resolveById($pdo, $tenantId);
    if ($tenant === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Tenant not found']);

        return;
    }

    $toSlug = trim((string) ($tenant['slug'] ?? ''));
    $fromSlug = isset($body['from_slug']) ? trim((string) $body['from_slug']) : 'web';
    $deleteSource = ! empty($body['delete_source']);

    if ($toSlug === '' || $fromSlug === $toSlug) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid slug migration']);

        return;
    }

    try {
        $result = QdrantCollectionMigrator::migrateSlugPrefix($fromSlug, $toSlug, $deleteSource);
        $vaultUpdates = QdrantCollectionMigrator::updateVaultCollectionOverrides($pdo, $fromSlug, $toSlug);

        echo json_encode([
            'success' => true,
            'data'    => [
                'from_slug'              => $fromSlug,
                'to_slug'                => $toSlug,
                'collections'            => $result['collections'],
                'points_migrated'        => $result['points_migrated'],
                'vault_overrides_updated' => $vaultUpdates,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Qdrant migration failed']);
    }
};
