<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/StorageDomain.php';
require_once __DIR__ . '/StorageLocator.php';
require_once __DIR__ . '/AuthSchemaBridge.php';
require_once __DIR__ . '/StorageSchemaEnsure.php';
require_once __DIR__ . '/CloudProviderRegistry.php';

/**
 * Per-tenant storage backend configuration ({@code oaao_tenant.storage_json}).
 */
final class TenantStorageConfig
{
    public const VERSION = 1;

    public const MODE_AUTO = 'auto';

    public const MODE_ADVANCE = 'advance';

    /** @return list<string> */
    private static function basicFieldKeys(): array
    {
        return [
            'backend',
            'bucket',
            'region',
            'credentials_env',
            'cdn_provider',
            'cdn_base_url',
            'cdn_signing_env',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function defaultConfig(string $tenantSlug): array
    {
        $slug = preg_replace('/[^a-z0-9_-]+/i', '-', $tenantSlug) ?: 'tenant';

        return [
            'version'       => self::VERSION,
            'settings_mode' => self::MODE_AUTO,
            'default'       => [
                'backend' => StorageLocator::BACKEND_LOCAL,
                'prefix'  => 'tenant-' . $slug . '/',
            ],
            'basic'     => [
                'backend' => StorageLocator::BACKEND_LOCAL,
            ],
            'cloud_providers' => [],
            'domains'   => [],
            'migration' => [
                'status'              => 'idle',
                'from_backend'        => StorageLocator::BACKEND_LOCAL,
                'to_backend'          => StorageLocator::BACKEND_LOCAL,
                'source_provider_id'  => '',
                'target_provider_id'  => '',
                'purge_source'        => true,
                'progress'            => ['total' => 0, 'done' => 0, 'failed' => 0],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function load(\PDO $pdo, int $tenantId): array
    {
        StorageSchemaEnsure::ensure($pdo);
        if ($tenantId < 1 || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return self::defaultConfig('default');
        }

        $st = $pdo->prepare('SELECT slug, storage_json FROM oaao_tenant WHERE tenant_id = ? LIMIT 1');
        $st->execute([$tenantId]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);
        if ($row === false) {
            return self::defaultConfig('default');
        }

        $slug = (string) ($row['slug'] ?? 'tenant');
        $base = self::defaultConfig($slug);
        $raw = isset($row['storage_json']) ? trim((string) $row['storage_json']) : '';
        if ($raw === '') {
            return $base;
        }

        try {
            /** @var mixed $parsed */
            $parsed = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return $base;
        }

        if (! \is_array($parsed)) {
            return $base;
        }

        return self::mergeConfig($base, $parsed);
    }

    /**
     * @param array<string, mixed> $base
     * @param array<string, mixed> $patch
     *
     * @return array<string, mixed>
     */
    public static function mergeConfig(array $base, array $patch): array
    {
        $out = $base;
        if (isset($patch['version'])) {
            $out['version'] = (int) $patch['version'];
        }
        if (isset($patch['default']) && \is_array($patch['default'])) {
            $out['default'] = array_merge($out['default'] ?? [], $patch['default']);
        }
        if (isset($patch['settings_mode']) && \is_string($patch['settings_mode'])) {
            $out['settings_mode'] = $patch['settings_mode'];
        }
        if (isset($patch['basic']) && \is_array($patch['basic'])) {
            $out['basic'] = array_merge(\is_array($out['basic'] ?? null) ? $out['basic'] : [], $patch['basic']);
        }
        if (isset($patch['cloud_providers']) && \is_array($patch['cloud_providers'])) {
            $out['cloud_providers'] = CloudProviderRegistry::mergeProviders($out, $patch['cloud_providers']);
        }
        if (isset($patch['cloud_providers_remove']) && \is_array($patch['cloud_providers_remove'])) {
            /** @var list<string> $removeIds */
            $removeIds = array_values(array_filter($patch['cloud_providers_remove'], '\is_string'));
            $out['cloud_providers'] = CloudProviderRegistry::removeProviders($out, $removeIds);
        }
        if (isset($patch['domains']) && \is_array($patch['domains'])) {
            $domains = \is_array($out['domains'] ?? null) ? $out['domains'] : [];
            foreach ($patch['domains'] as $domain => $cfg) {
                if (! \is_string($domain) || ! StorageDomain::isValid($domain) || ! \is_array($cfg)) {
                    continue;
                }
                $domains[$domain] = array_merge(\is_array($domains[$domain] ?? null) ? $domains[$domain] : [], $cfg);
            }
            $out['domains'] = $domains;
        }
        if (isset($patch['migration']) && \is_array($patch['migration'])) {
            $out['migration'] = array_merge(\is_array($out['migration'] ?? null) ? $out['migration'] : [], $patch['migration']);
        }

        return self::normalizeConfig($out);
    }

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function normalizeConfig(array $config): array
    {
        $default = \is_array($config['default'] ?? null) ? $config['default'] : [];
        $backend = isset($default['backend']) ? strtolower(trim((string) $default['backend'])) : StorageLocator::BACKEND_LOCAL;
        if (! \in_array($backend, StorageLocator::backends(), true)) {
            $backend = StorageLocator::BACKEND_LOCAL;
        }
        $default['backend'] = $backend;
        $default['prefix'] = isset($default['prefix']) ? trim((string) $default['prefix']) : 'tenant-/';
        if ($default['prefix'] !== '' && ! str_ends_with($default['prefix'], '/')) {
            $default['prefix'] .= '/';
        }
        $config['default'] = $default;

        $mode = isset($config['settings_mode']) ? strtolower(trim((string) $config['settings_mode'])) : '';
        if (! \in_array($mode, [self::MODE_AUTO, self::MODE_ADVANCE], true)) {
            $mode = self::inferSettingsMode($config);
        }
        $config['settings_mode'] = $mode;

        $basic = \is_array($config['basic'] ?? null) ? $config['basic'] : [];
        $basicBackend = isset($basic['backend']) ? strtolower(trim((string) $basic['backend'])) : $backend;
        if (! \in_array($basicBackend, StorageLocator::backends(), true)) {
            $basicBackend = $backend;
        }
        $basic['backend'] = $basicBackend;
        $basicProvider = isset($basic['cdn_provider'])
            ? strtolower(trim((string) $basic['cdn_provider']))
            : 'none';
        if (! \in_array($basicProvider, ['none', 'generic', 'cloudfront', 'gcs', 'cloudflare'], true)) {
            $basicProvider = 'none';
        }
        $basic['cdn_provider'] = $basicProvider;
        $config['basic'] = $basic;

        $domains = \is_array($config['domains'] ?? null) ? $config['domains'] : [];
        foreach (StorageDomain::all() as $domain) {
            if (! isset($domains[$domain]) || ! \is_array($domains[$domain])) {
                continue;
            }
            $b = isset($domains[$domain]['backend']) ? strtolower(trim((string) $domains[$domain]['backend'])) : $backend;
            if (! \in_array($b, StorageLocator::backends(), true)) {
                $b = $backend;
            }
            $domains[$domain]['backend'] = $b;
            $provider = isset($domains[$domain]['cdn_provider'])
                ? strtolower(trim((string) $domains[$domain]['cdn_provider']))
                : 'none';
            if (! \in_array($provider, ['none', 'generic', 'cloudfront', 'gcs', 'cloudflare'], true)) {
                $provider = 'none';
            }
            $domains[$domain]['cdn_provider'] = $provider;
        }
        $config['domains'] = $domains;

        $migration = \is_array($config['migration'] ?? null) ? $config['migration'] : [];
        if (! isset($migration['purge_source'])) {
            $migration['purge_source'] = true;
        } else {
            $migration['purge_source'] = filter_var($migration['purge_source'], FILTER_VALIDATE_BOOLEAN);
        }
        $config['migration'] = $migration;

        return $config;
    }

    /**
     * @param array<string, mixed> $config
     */
    public static function settingsMode(array $config): string
    {
        $mode = isset($config['settings_mode']) ? strtolower(trim((string) $config['settings_mode'])) : '';

        return \in_array($mode, [self::MODE_AUTO, self::MODE_ADVANCE], true)
            ? $mode
            : self::inferSettingsMode($config);
    }

    /**
     * Legacy configs with per-domain rows default to advance.
     *
     * @param array<string, mixed> $config
     */
    private static function inferSettingsMode(array $config): string
    {
        $domains = \is_array($config['domains'] ?? null) ? $config['domains'] : [];
        foreach ($domains as $cfg) {
            if (\is_array($cfg) && $cfg !== []) {
                return self::MODE_ADVANCE;
            }
        }

        return self::MODE_AUTO;
    }

    /**
     * Object key folder for a domain ({@code tenant-acme/vault/…}).
     *
     * @param array<string, mixed> $config
     */
    public static function domainFolderPrefix(array $config, string $domain): string
    {
        $prefix = isset($config['default']['prefix']) ? trim((string) $config['default']['prefix']) : '';
        if ($prefix !== '' && ! str_ends_with($prefix, '/')) {
            $prefix .= '/';
        }

        return $prefix . $domain . '/';
    }

    /**
     * Effective domain backend row (inherits default).
     *
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function domainConfig(array $config, string $domain): array
    {
        $default = \is_array($config['default'] ?? null) ? $config['default'] : [];

        if (self::settingsMode($config) === self::MODE_AUTO) {
            $basic = \is_array($config['basic'] ?? null) ? $config['basic'] : [];

            return array_merge($default, $basic);
        }

        $domains = \is_array($config['domains'] ?? null) ? $config['domains'] : [];
        $override = \is_array($domains[$domain] ?? null) ? $domains[$domain] : [];

        return array_merge($default, $override);
    }

    /**
     * Runtime domain row with provider credentials expanded (for orchestrator proxy).
     *
     * @param array<string, mixed> $config
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function resolveDomainConfig(array $config, array $row): array
    {
        return CloudProviderRegistry::resolveRow($config, $row, true);
    }

    /**
     * Active write/read provider for a domain.
     *
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function activeDomainConfig(array $config, string $domain): array
    {
        return self::resolveDomainConfig($config, self::domainConfig($config, $domain));
    }

    /**
     * Migration destination — may differ from active provider during A→B cutover.
     *
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function migrationTargetConfig(array $config, string $domain): array
    {
        $migration = \is_array($config['migration'] ?? null) ? $config['migration'] : [];
        $targetPid = isset($migration['target_provider_id']) ? trim((string) $migration['target_provider_id']) : '';
        if ($targetPid === 'local') {
            $default = \is_array($config['default'] ?? null) ? $config['default'] : [];

            return array_merge($default, ['backend' => StorageLocator::BACKEND_LOCAL]);
        }
        if ($targetPid !== '') {
            $prov = CloudProviderRegistry::get($config, $targetPid);
            if ($prov !== null) {
                $basic = \is_array($config['basic'] ?? null) ? $config['basic'] : [];
                $row = array_merge($basic, [
                    'provider_id' => $targetPid,
                    'backend'     => $prov['backend'] ?? StorageLocator::BACKEND_LOCAL,
                    'bucket'      => $prov['bucket'] ?? '',
                    'region'      => $prov['region'] ?? '',
                ]);

                return self::resolveDomainConfig($config, $row);
            }
        }

        return self::activeDomainConfig($config, $domain);
    }

    /**
     * Migration source credentials (override when objects still on provider A).
     *
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function migrationSourceConfig(array $config, string $domain): array
    {
        $migration = \is_array($config['migration'] ?? null) ? $config['migration'] : [];
        $sourcePid = isset($migration['source_provider_id']) ? trim((string) $migration['source_provider_id']) : '';
        if ($sourcePid === 'local') {
            $default = \is_array($config['default'] ?? null) ? $config['default'] : [];

            return array_merge($default, ['backend' => StorageLocator::BACKEND_LOCAL]);
        }
        if ($sourcePid !== '') {
            $prov = CloudProviderRegistry::get($config, $sourcePid);
            if ($prov !== null) {
                $row = [
                    'provider_id' => $sourcePid,
                    'backend'     => $prov['backend'] ?? StorageLocator::BACKEND_LOCAL,
                    'bucket'      => $prov['bucket'] ?? '',
                    'region'      => $prov['region'] ?? '',
                ];

                return self::resolveDomainConfig($config, $row);
            }
        }

        return self::activeDomainConfig($config, $domain);
    }

    public static function prefixedKey(array $config, string $domain, string $relativeKey): string
    {
        $domainCfg = self::domainConfig($config, $domain);
        $prefix = isset($domainCfg['prefix']) ? trim((string) $domainCfg['prefix']) : '';
        if ($prefix === '') {
            $prefix = isset($config['default']['prefix']) ? trim((string) $config['default']['prefix']) : '';
        }
        if ($prefix !== '' && ! str_ends_with($prefix, '/')) {
            $prefix .= '/';
        }
        $rel = ltrim(str_replace(["\0", '..'], '', trim($relativeKey)), '/');

        return $prefix . $domain . '/' . $rel;
    }

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    public static function publicPayload(array $config, ?string $tenantSlug = null): array
    {
        $out = self::normalizeConfig($config);
        $domains = \is_array($out['domains'] ?? null) ? $out['domains'] : [];
        foreach ($domains as $domain => $cfg) {
            if (! \is_array($cfg)) {
                continue;
            }
            unset($domains[$domain]['secret_key'], $domains[$domain]['access_key']);
            if (isset($domains[$domain]['credentials_env'])) {
                $domains[$domain]['credentials_env'] = trim((string) $domains[$domain]['credentials_env']);
            }
        }
        $out['domains'] = $domains;

        $basic = \is_array($out['basic'] ?? null) ? $out['basic'] : [];
        unset($basic['secret_key'], $basic['access_key']);
        $out['basic'] = $basic;

        $providers = CloudProviderRegistry::all($out);
        $out['cloud_providers'] = CloudProviderRegistry::publicProviders($providers);

        /** @var list<string> $providerOptions */
        $providerOptions = [];
        foreach ($providers as $id => $prov) {
            if (\is_array($prov)) {
                $providerOptions[] = (string) $id;
            }
        }
        $out['cloud_provider_ids'] = $providerOptions;

        /** @var array<string, string> $folderMap */
        $folderMap = [];
        foreach (StorageDomain::all() as $domain) {
            $folderMap[$domain] = self::domainFolderPrefix($out, $domain);
        }
        $out['domain_folders'] = $folderMap;

        if ($tenantSlug !== null && $tenantSlug !== '') {
            $out['tenant_slug'] = $tenantSlug;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $patch
     */
    public static function save(\PDO $pdo, int $tenantId, array $patch): array
    {
        StorageSchemaEnsure::ensure($pdo);
        if ($tenantId < 1) {
            throw new \InvalidArgumentException('tenant_id required');
        }

        $current = self::load($pdo, $tenantId);
        $merged = self::mergeConfig($current, $patch);
        if (self::settingsMode($merged) === self::MODE_AUTO) {
            $merged['domains'] = [];
        }
        $json = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $pdo->prepare('UPDATE oaao_tenant SET storage_json = ?, updated_at = ?::timestamptz WHERE tenant_id = ?')
            ->execute([$json, date('c'), $tenantId]);

        return self::publicPayload($merged);
    }

    /**
     * @param array<string, mixed> $domainCfg
     */
    public static function validateDomainConfig(array $domainCfg): ?string
    {
        return self::validateCloudBackendRow($domainCfg);
    }

    /**
     * @param array<string, mixed> $basicCfg
     */
    public static function validateBasicConfig(array $basicCfg): ?string
    {
        return self::validateCloudBackendRow($basicCfg);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function validateCloudBackendRow(array $row): ?string
    {
        $backend = isset($row['backend']) ? strtolower(trim((string) $row['backend'])) : StorageLocator::BACKEND_LOCAL;
        if (! \in_array($backend, StorageLocator::backends(), true)) {
            return 'Invalid backend';
        }
        if ($backend === StorageLocator::BACKEND_LOCAL) {
            return null;
        }
        $bucket = isset($row['bucket']) ? trim((string) $row['bucket']) : '';
        if ($bucket === '') {
            return 'bucket is required for cloud backends';
        }
        if (self::rowHasInlineCredentials($row)) {
            return null;
        }
        $pid = isset($row['provider_id']) ? trim((string) $row['provider_id']) : '';
        if ($pid !== '') {
            return null;
        }
        $cred = isset($row['credentials_env']) ? trim((string) $row['credentials_env']) : '';
        if ($cred === '') {
            return 'provider_id or credentials are required for cloud backends';
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function rowHasInlineCredentials(array $row): bool
    {
        $cred = $row['credentials'] ?? null;
        if (! \is_array($cred)) {
            return false;
        }
        if (trim((string) ($cred['token'] ?? '')) !== '') {
            return true;
        }

        return trim((string) ($cred['access_key'] ?? '')) !== ''
            && trim((string) ($cred['secret_key'] ?? '')) !== '';
    }
}
