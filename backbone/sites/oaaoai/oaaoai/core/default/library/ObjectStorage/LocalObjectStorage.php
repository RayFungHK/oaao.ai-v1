<?php

declare(strict_types=1);

namespace Oaaoai\Core\ObjectStorage;

require_once __DIR__ . '/../StorageDomain.php';
require_once __DIR__ . '/../StorageLocator.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageLocator;

final class LocalObjectStorage implements ObjectStorageInterface
{
    public function __construct(
        private readonly string $domain,
        private readonly string $localRoot,
    ) {
    }

    public function putFile(string $sourcePath, StorageLocator $dest): StorageLocator
    {
        $abs = $this->absolutePath($dest);
        $dir = dirname($abs);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('local storage mkdir failed');
        }
        if (! @rename($sourcePath, $abs) && ! @copy($sourcePath, $abs)) {
            throw new \RuntimeException('local storage write failed');
        }
        $size = filesize($abs);

        return new StorageLocator(
            StorageLocator::BACKEND_LOCAL,
            $dest->key,
            null,
            null,
            null,
            \is_int($size) ? $size : $dest->size,
            $this->localRoot,
        );
    }

    public function putContent(string $content, StorageLocator $dest): StorageLocator
    {
        $abs = $this->absolutePath($dest);
        $dir = dirname($abs);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('local storage mkdir failed');
        }
        if (file_put_contents($abs, $content) === false) {
            throw new \RuntimeException('local storage write failed');
        }

        return new StorageLocator(
            StorageLocator::BACKEND_LOCAL,
            $dest->key,
            null,
            null,
            null,
            strlen($content),
            $this->localRoot,
        );
    }

    public function delete(StorageLocator $locator): void
    {
        $abs = $this->absolutePath($locator);
        if (is_file($abs)) {
            @unlink($abs);
        }
    }

    public function exists(StorageLocator $locator): bool
    {
        return is_file($this->absolutePath($locator));
    }

    public function readStream(StorageLocator $locator)
    {
        $abs = $this->absolutePath($locator);
        if (! is_file($abs)) {
            return null;
        }
        $fh = @fopen($abs, 'rb');

        return $fh !== false ? $fh : null;
    }

    public function presignGet(StorageLocator $locator, int $ttlSec = 3600): ?string
    {
        unset($locator, $ttlSec);

        return null;
    }

    public function materialize(StorageLocator $locator, int $tenantId): string
    {
        unset($tenantId);
        $abs = $this->absolutePath($locator);
        if (! is_file($abs)) {
            throw new \RuntimeException('local blob missing: ' . $locator->key);
        }

        return $abs;
    }

    private function absolutePath(StorageLocator $locator): string
    {
        $root = $locator->localRoot ?? $this->localRoot;

        return rtrim($root, '/\\') . '/' . ltrim($locator->key, '/');
    }
}
