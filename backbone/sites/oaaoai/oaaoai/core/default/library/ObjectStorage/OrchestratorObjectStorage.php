<?php

declare(strict_types=1);

namespace Oaaoai\Core\ObjectStorage;

require_once __DIR__ . '/../StorageOrchestratorClient.php';
require_once __DIR__ . '/LocalObjectStorage.php';

use Oaaoai\Core\StorageLocator;
use Oaaoai\Core\StorageOrchestratorClient;

final class OrchestratorObjectStorage implements ObjectStorageInterface
{
    /**
     * @param array<string, mixed> $domainConfig
     */
    public function __construct(
        private readonly int $tenantId,
        private readonly string $domain,
        private readonly array $domainConfig,
    ) {
    }

    public function putFile(string $sourcePath, StorageLocator $dest): StorageLocator
    {
        $body = file_get_contents($sourcePath);
        if ($body === false) {
            throw new \RuntimeException('read source failed');
        }

        return $this->putContent($body, $dest);
    }

    public function putContent(string $content, StorageLocator $dest): StorageLocator
    {
        $resp = StorageOrchestratorClient::post('put', [
            'tenant_id'     => $this->tenantId,
            'domain'        => $this->domain,
            'domain_config' => $this->domainConfig,
            'locator'       => $dest->toArray(),
            'content_b64'   => base64_encode($content),
        ]);
        if (! \is_array($resp) || empty($resp['ok'])) {
            throw new \RuntimeException('orchestrator storage put failed');
        }
        $loc = \is_array($resp['locator'] ?? null) ? $resp['locator'] : $dest->toArray();

        return StorageLocator::decodeJson(json_encode($loc, JSON_THROW_ON_ERROR)) ?? $dest;
    }

    public function delete(StorageLocator $locator): void
    {
        StorageOrchestratorClient::post('delete', [
            'tenant_id'     => $this->tenantId,
            'domain'        => $this->domain,
            'domain_config' => $this->domainConfig,
            'locator'       => $locator->toArray(),
        ]);
    }

    public function exists(StorageLocator $locator): bool
    {
        $resp = StorageOrchestratorClient::post('exists', [
            'tenant_id'     => $this->tenantId,
            'domain'        => $this->domain,
            'domain_config' => $this->domainConfig,
            'locator'       => $locator->toArray(),
        ]);

        return \is_array($resp) && ! empty($resp['exists']);
    }

    public function readStream(StorageLocator $locator)
    {
        $abs = $this->materialize($locator, $this->tenantId);
        $fh = @fopen($abs, 'rb');

        return $fh !== false ? $fh : null;
    }

    public function presignGet(StorageLocator $locator, int $ttlSec = 3600): ?string
    {
        $resp = StorageOrchestratorClient::post('presign', [
            'tenant_id'     => $this->tenantId,
            'domain'        => $this->domain,
            'domain_config' => $this->domainConfig,
            'locator'       => $locator->toArray(),
            'ttl_sec'       => $ttlSec,
        ]);
        if (! \is_array($resp) || empty($resp['url'])) {
            return null;
        }

        return (string) $resp['url'];
    }

    public function materialize(StorageLocator $locator, int $tenantId): string
    {
        $resp = StorageOrchestratorClient::post('materialize', [
            'tenant_id'     => $tenantId,
            'domain'        => $this->domain,
            'domain_config' => $this->domainConfig,
            'locator'       => $locator->toArray(),
        ], 300);
        if (! \is_array($resp) || empty($resp['absolute_path'])) {
            throw new \RuntimeException('orchestrator materialize failed');
        }

        return (string) $resp['absolute_path'];
    }
}
