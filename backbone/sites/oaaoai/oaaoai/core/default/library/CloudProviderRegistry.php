<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Tenant-scoped cloud provider profiles ({@code storage_json.cloud_providers}).
 *
 * Credentials live in PostgreSQL (admin-only APIs), not container env — supports hot-add and A→B migration overlap.
 */
final class CloudProviderRegistry
{
    /** @var list<string> */
    public const CREDENTIAL_KEYS = ['token', 'access_key', 'secret_key', 'endpoint_url', 'project'];

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, array<string, mixed>>
     */
    public static function all(array $config): array
    {
        $raw = $config['cloud_providers'] ?? null;

        return \is_array($raw) ? $raw : [];
    }

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>|null
     */
    public static function get(array $config, string $providerId): ?array
    {
        $id = self::normalizeId($providerId);
        if ($id === '') {
            return null;
        }
        $all = self::all($config);

        return isset($all[$id]) && \is_array($all[$id]) ? $all[$id] : null;
    }

    /**
     * @param array<string, mixed> $config
     * @param array<string, mixed> $patch
     *
     * @return array<string, mixed>
     */
    public static function mergeProviders(array $config, array $patch): array
    {
        $existing = self::all($config);
        foreach ($patch as $id => $row) {
            if (! \is_string($id) || ! \is_array($row)) {
                continue;
            }
            $normId = self::normalizeId($id);
            if ($normId === '') {
                continue;
            }
            $prev = isset($existing[$normId]) && \is_array($existing[$normId]) ? $existing[$normId] : [];
            $merged = array_merge($prev, $row);
            $merged['id'] = $normId;
            if (isset($merged['label'])) {
                $merged['label'] = trim((string) $merged['label']);
            }
            if (isset($merged['backend'])) {
                $merged['backend'] = strtolower(trim((string) $merged['backend']));
            }
            if (isset($merged['bucket'])) {
                $merged['bucket'] = trim((string) $merged['bucket']);
            }
            if (isset($merged['region'])) {
                $merged['region'] = trim((string) $merged['region']);
            }
            if (isset($merged['credentials']) && \is_array($merged['credentials'])) {
                $merged['credentials'] = self::mergeCredentials(
                    isset($prev['credentials']) && \is_array($prev['credentials']) ? $prev['credentials'] : [],
                    $merged['credentials'],
                );
            } elseif (isset($prev['credentials']) && \is_array($prev['credentials'])) {
                $merged['credentials'] = $prev['credentials'];
            }
            $existing[$normId] = self::normalizeProviderRow($merged);
        }

        return $existing;
    }

    /**
     * @param list<string> $removeIds
     *
     * @return array<string, array<string, mixed>>
     */
    public static function removeProviders(array $config, array $removeIds): array
    {
        $existing = self::all($config);
        foreach ($removeIds as $id) {
            if (! \is_string($id)) {
                continue;
            }
            unset($existing[self::normalizeId($id)]);
        }

        return $existing;
    }

    /**
     * Expand {@code provider_id} into runtime domain_config (includes credentials for orchestrator).
     *
     * @param array<string, mixed> $config
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function resolveRow(array $config, array $row, bool $includeSecrets = true): array
    {
        $out = $row;
        $pid = isset($row['provider_id']) ? trim((string) $row['provider_id']) : '';
        if ($pid === '') {
            return $out;
        }

        $prov = self::get($config, $pid);
        if ($prov === null) {
            return $out;
        }

        foreach (['backend', 'bucket', 'region'] as $key) {
            if (isset($prov[$key]) && trim((string) $prov[$key]) !== '') {
                $out[$key] = $prov[$key];
            }
        }
        if ($includeSecrets && isset($prov['credentials']) && \is_array($prov['credentials'])) {
            $out['credentials'] = $prov['credentials'];
        }
        $out['provider_id'] = $pid;

        return $out;
    }

    /**
     * @param array<string, mixed> $provider
     */
    public static function validateProvider(array $provider): ?string
    {
        $backend = isset($provider['backend']) ? strtolower(trim((string) $provider['backend'])) : '';
        if (! \in_array($backend, StorageLocator::backends(), true) || $backend === StorageLocator::BACKEND_LOCAL) {
            return 'Invalid provider backend';
        }
        if (trim((string) ($provider['bucket'] ?? '')) === '') {
            return 'Provider bucket is required';
        }
        if (! self::hasConfiguredCredentials($provider)) {
            return 'Provider credentials are required';
        }

        return null;
    }

    /**
     * @param array<string, mixed> $provider
     */
    public static function hasConfiguredCredentials(array $provider): bool
    {
        $cred = $provider['credentials'] ?? null;
        if (! \is_array($cred)) {
            return false;
        }
        if (trim((string) ($cred['token'] ?? '')) !== '') {
            return true;
        }
        if (trim((string) ($cred['access_key'] ?? '')) !== ''
            && trim((string) ($cred['secret_key'] ?? '')) !== '') {
            return true;
        }

        return false;
    }

    /**
     * @param array<string, mixed>|null $credentials
     *
     * @return array<string, mixed>
     */
    public static function redactCredentials(?array $credentials): array
    {
        if ($credentials === null || $credentials === []) {
            return ['configured' => false];
        }
        /** @var array<string, mixed> $out */
        $out = ['configured' => self::hasConfiguredCredentials(['credentials' => $credentials])];
        foreach (self::CREDENTIAL_KEYS as $key) {
            if (! isset($credentials[$key]) || trim((string) $credentials[$key]) === '') {
                continue;
            }
            $out[$key] = '••••••';
        }

        return $out;
    }

    /**
     * @param array<string, array<string, mixed>> $providers
     *
     * @return array<string, array<string, mixed>>
     */
    public static function publicProviders(array $providers): array
    {
        $out = [];
        foreach ($providers as $id => $row) {
            if (! \is_array($row)) {
                continue;
            }
            $pub = $row;
            $pub['credentials'] = self::redactCredentials(
                isset($row['credentials']) && \is_array($row['credentials']) ? $row['credentials'] : null,
            );
            unset($pub['secret_key'], $pub['access_key']);
            $out[$id] = $pub;
        }

        return $out;
    }

    public static function normalizeId(string $id): string
    {
        $id = strtolower(trim($id));
        $id = preg_replace('/[^a-z0-9_-]+/', '-', $id) ?? '';

        return trim($id, '-');
    }

    public static function suggestId(string $label): string
    {
        $base = self::normalizeId($label);
        if ($base === '') {
            $base = 'provider';
        }
        if (! str_starts_with($base, 'prov_')) {
            $base = 'prov_' . $base;
        }

        return substr($base, 0, 48);
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    private static function normalizeProviderRow(array $row): array
    {
        $backend = isset($row['backend']) ? strtolower(trim((string) $row['backend'])) : StorageLocator::BACKEND_S3;
        if (! \in_array($backend, StorageLocator::backends(), true)) {
            $backend = StorageLocator::BACKEND_S3;
        }
        $row['backend'] = $backend;
        $row['bucket'] = trim((string) ($row['bucket'] ?? ''));
        $row['region'] = trim((string) ($row['region'] ?? ''));
        if (! isset($row['label']) || trim((string) $row['label']) === '') {
            $row['label'] = (string) ($row['id'] ?? 'Provider');
        }

        return $row;
    }

    /**
     * @param array<string, mixed> $prev
     * @param array<string, mixed> $patch
     *
     * @return array<string, mixed>
     */
    private static function mergeCredentials(array $prev, array $patch): array
    {
        $out = $prev;
        foreach (self::CREDENTIAL_KEYS as $key) {
            if (! \array_key_exists($key, $patch)) {
                continue;
            }
            $val = trim((string) $patch[$key]);
            if ($val === '' || $val === '••••••') {
                continue;
            }
            $out[$key] = $patch[$key];
        }

        return $out;
    }
}
