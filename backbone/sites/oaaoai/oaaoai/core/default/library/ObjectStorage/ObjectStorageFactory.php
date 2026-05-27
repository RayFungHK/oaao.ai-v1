<?php

declare(strict_types=1);

namespace Oaaoai\Core\ObjectStorage;

require_once __DIR__ . '/../TenantStorageConfig.php';
require_once __DIR__ . '/../StorageDomain.php';
require_once __DIR__ . '/ObjectStorageInterface.php';
require_once __DIR__ . '/LocalObjectStorage.php';
require_once __DIR__ . '/OrchestratorObjectStorage.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageLocator;
use Oaaoai\Core\TenantStorageConfig;

final class ObjectStorageFactory
{
    /**
     * @param array<string, mixed>|null $tenantConfig
     */
    public static function forDomain(\PDO $pdo, int $tenantId, string $domain, ?array $tenantConfig = null): ObjectStorageInterface
    {
        $config = $tenantConfig ?? TenantStorageConfig::load($pdo, $tenantId);
        $domainCfg = TenantStorageConfig::activeDomainConfig($config, $domain);
        $backend = isset($domainCfg['backend']) ? strtolower(trim((string) $domainCfg['backend'])) : StorageLocator::BACKEND_LOCAL;

        if ($backend === StorageLocator::BACKEND_LOCAL) {
            return new LocalObjectStorage($domain, StorageDomain::defaultLocalRoot($domain));
        }

        return new OrchestratorObjectStorage($tenantId, $domain, $domainCfg);
    }
}
