<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Unified object locator persisted on blob rows and in job payloads.
 *
 * @phpstan-type LocatorArray array{backend: string, key: string, bucket?: string|null, region?: string|null, etag?: string|null, size?: int|null, local_root?: string|null}
 */
final class StorageLocator
{
    public const BACKEND_LOCAL = 'local';

    public const BACKEND_S3 = 's3';

    public const BACKEND_GCS = 'gcs';

    public const BACKEND_HF = 'hf';

    /** @return list<string> */
    public static function backends(): array
    {
        return [self::BACKEND_LOCAL, self::BACKEND_S3, self::BACKEND_GCS, self::BACKEND_HF];
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(?string $locatorJson, ?string $legacyRelativePath, string $domain, ?string $legacyRoot = null): ?self
    {
        if ($locatorJson !== null && trim($locatorJson) !== '') {
            $parsed = self::decodeJson($locatorJson);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        if ($legacyRelativePath === null || trim($legacyRelativePath) === '') {
            return null;
        }

        $rel = ltrim(str_replace(["\0"], '', trim($legacyRelativePath)), '/');
        if ($rel === '' || str_contains($rel, '..')) {
            return null;
        }

        return new self(
            self::BACKEND_LOCAL,
            $rel,
            null,
            null,
            null,
            null,
            $legacyRoot ?? StorageDomain::defaultLocalRoot($domain),
        );
    }

    public static function decodeJson(?string $json): ?self
    {
        if ($json === null || trim($json) === '') {
            return null;
        }

        try {
            /** @var mixed $raw */
            $raw = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return null;
        }

        if (! \is_array($raw)) {
            return null;
        }

        $backend = isset($raw['backend']) ? strtolower(trim((string) $raw['backend'])) : '';
        $key = isset($raw['key']) ? ltrim(trim((string) $raw['key']), '/') : '';
        if ($backend === '' || $key === '' || str_contains($key, '..')) {
            return null;
        }
        if (! \in_array($backend, self::backends(), true)) {
            return null;
        }

        return new self(
            $backend,
            $key,
            isset($raw['bucket']) ? trim((string) $raw['bucket']) : null,
            isset($raw['region']) ? trim((string) $raw['region']) : null,
            isset($raw['etag']) ? trim((string) $raw['etag']) : null,
            isset($raw['size']) ? (int) $raw['size'] : null,
            isset($raw['local_root']) ? rtrim(trim((string) $raw['local_root']), '/\\') : null,
        );
    }

    public function __construct(
        public readonly string $backend,
        public readonly string $key,
        public readonly ?string $bucket = null,
        public readonly ?string $region = null,
        public readonly ?string $etag = null,
        public readonly ?int $size = null,
        public readonly ?string $localRoot = null,
    ) {
    }

    public function isLocal(): bool
    {
        return $this->backend === self::BACKEND_LOCAL;
    }

    /**
     * @return LocatorArray
     */
    public function toArray(): array
    {
        $out = [
            'backend' => $this->backend,
            'key'     => $this->key,
        ];
        if ($this->bucket !== null && $this->bucket !== '') {
            $out['bucket'] = $this->bucket;
        }
        if ($this->region !== null && $this->region !== '') {
            $out['region'] = $this->region;
        }
        if ($this->etag !== null && $this->etag !== '') {
            $out['etag'] = $this->etag;
        }
        if ($this->size !== null && $this->size > 0) {
            $out['size'] = $this->size;
        }
        if ($this->localRoot !== null && $this->localRoot !== '') {
            $out['local_root'] = $this->localRoot;
        }

        return $out;
    }

    public function toJson(): string
    {
        return json_encode($this->toArray(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public function localAbsolutePath(string $domain): string
    {
        $root = $this->localRoot ?? StorageDomain::defaultLocalRoot($domain);

        return rtrim($root, '/\\') . '/' . $this->key;
    }
}
