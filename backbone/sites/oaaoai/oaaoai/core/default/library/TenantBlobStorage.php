<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/ObjectStorage/ObjectStorageFactory.php';
require_once __DIR__ . '/TenantStorageConfig.php';
require_once __DIR__ . '/StorageLocator.php';

use Oaaoai\Core\ObjectStorage\ObjectStorageFactory;

/**
 * High-level tenant blob API used by vault, chat, slides, mine, live-meeting modules.
 */
final class TenantBlobStorage
{
    /** @var array<string, mixed> */
    private array $tenantConfig;

    public function __construct(
        private readonly \PDO $pdo,
        private readonly int $tenantId,
        private readonly string $domain,
    ) {
        $this->tenantConfig = TenantStorageConfig::load($pdo, $tenantId);
    }

    public function buildKey(string $relativeKey): string
    {
        return TenantStorageConfig::prefixedKey($this->tenantConfig, $this->domain, $relativeKey);
    }

    public function putUploadedFile(string $tmpPath, string $relativeKey): StorageLocator
    {
        $store = ObjectStorageFactory::forDomain($this->pdo, $this->tenantId, $this->domain, $this->tenantConfig);
        $domainCfg = TenantStorageConfig::domainConfig($this->tenantConfig, $this->domain);
        $backend = isset($domainCfg['backend']) ? strtolower(trim((string) $domainCfg['backend'])) : StorageLocator::BACKEND_LOCAL;
        $key = $this->buildKey($relativeKey);

        $dest = new StorageLocator(
            $backend,
            $key,
            isset($domainCfg['bucket']) ? trim((string) $domainCfg['bucket']) : null,
            isset($domainCfg['region']) ? trim((string) $domainCfg['region']) : null,
        );

        if ($backend === StorageLocator::BACKEND_LOCAL) {
            // Local keys strip tenant prefix for backward-compatible relative paths on disk.
            $dest = new StorageLocator(
                StorageLocator::BACKEND_LOCAL,
                ltrim($relativeKey, '/'),
                null,
                null,
                null,
                null,
                StorageDomain::defaultLocalRoot($this->domain),
            );
        }

        return $store->putFile($tmpPath, $dest);
    }

    public function putContent(string $content, string $relativeKey): StorageLocator
    {
        $store = ObjectStorageFactory::forDomain($this->pdo, $this->tenantId, $this->domain, $this->tenantConfig);
        $domainCfg = TenantStorageConfig::domainConfig($this->tenantConfig, $this->domain);
        $backend = isset($domainCfg['backend']) ? strtolower(trim((string) $domainCfg['backend'])) : StorageLocator::BACKEND_LOCAL;

        if ($backend === StorageLocator::BACKEND_LOCAL) {
            $dest = new StorageLocator(
                StorageLocator::BACKEND_LOCAL,
                ltrim($relativeKey, '/'),
                null,
                null,
                null,
                strlen($content),
                StorageDomain::defaultLocalRoot($this->domain),
            );
        } else {
            $dest = new StorageLocator(
                $backend,
                $this->buildKey($relativeKey),
                isset($domainCfg['bucket']) ? trim((string) $domainCfg['bucket']) : null,
                isset($domainCfg['region']) ? trim((string) $domainCfg['region']) : null,
            );
        }

        return $store->putContent($content, $dest);
    }

    public function resolveAbsolutePath(?string $locatorJson, ?string $legacyRelativePath, ?string $legacyRoot = null): string
    {
        $locator = StorageLocator::fromRow($locatorJson, $legacyRelativePath, $this->domain, $legacyRoot);
        if ($locator === null) {
            throw new \RuntimeException('blob locator missing');
        }

        if ($locator->isLocal()) {
            return $locator->localAbsolutePath($this->domain);
        }

        $store = ObjectStorageFactory::forDomain($this->pdo, $this->tenantId, $this->domain, $this->tenantConfig);

        return $store->materialize($locator, $this->tenantId);
    }

    public function delete(?string $locatorJson, ?string $legacyRelativePath, ?string $legacyRoot = null): void
    {
        $locator = StorageLocator::fromRow($locatorJson, $legacyRelativePath, $this->domain, $legacyRoot);
        if ($locator === null) {
            return;
        }
        $store = ObjectStorageFactory::forDomain($this->pdo, $this->tenantId, $this->domain, $this->tenantConfig);
        $store->delete($locator);
    }

    public function presignOrAbsolute(?string $locatorJson, ?string $legacyRelativePath, ?string $legacyRoot = null): array
    {
        $locator = StorageLocator::fromRow($locatorJson, $legacyRelativePath, $this->domain, $legacyRoot);
        if ($locator === null) {
            throw new \RuntimeException('blob locator missing');
        }

        if ($locator->isLocal()) {
            return ['mode' => 'local', 'absolute_path' => $locator->localAbsolutePath($this->domain)];
        }

        $store = ObjectStorageFactory::forDomain($this->pdo, $this->tenantId, $this->domain, $this->tenantConfig);
        $url = $store->presignGet($locator);
        if ($url !== null && $url !== '') {
            return ['mode' => 'redirect', 'url' => $url];
        }

        return ['mode' => 'local', 'absolute_path' => $store->materialize($locator, $this->tenantId)];
    }

    /**
     * @return array<string, mixed>
     */
    public function jobPayloadExtras(StorageLocator $locator, string $legacyRelativePath, string $legacyRoot): array
    {
        $payload = [
            'relative_path'        => $legacyRelativePath,
            'storage_root'         => $legacyRoot,
            'storage_locator'      => $locator->toArray(),
            'storage_locator_json' => $locator->toJson(),
        ];

        if ($locator->isLocal()) {
            $payload['absolute_path'] = $locator->localAbsolutePath($this->domain);
        }

        return $payload;
    }

    /** @return array<string, mixed> */
    public function tenantConfig(): array
    {
        return $this->tenantConfig;
    }
}
