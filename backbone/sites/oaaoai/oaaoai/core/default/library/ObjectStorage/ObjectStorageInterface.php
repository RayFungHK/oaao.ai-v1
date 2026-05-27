<?php

declare(strict_types=1);

namespace Oaaoai\Core\ObjectStorage;

use Oaaoai\Core\StorageLocator;

interface ObjectStorageInterface
{
    public function putFile(string $sourcePath, StorageLocator $dest): StorageLocator;

    public function putContent(string $content, StorageLocator $dest): StorageLocator;

    public function delete(StorageLocator $locator): void;

    public function exists(StorageLocator $locator): bool;

    /**
     * @return resource|null readable stream
     */
    public function readStream(StorageLocator $locator);

    /** Presigned GET URL for cloud backends; null when not supported. */
    public function presignGet(StorageLocator $locator, int $ttlSec = 3600): ?string;

    /** Materialize to local absolute path (for orchestrator workers). */
    public function materialize(StorageLocator $locator, int $tenantId): string;
}
