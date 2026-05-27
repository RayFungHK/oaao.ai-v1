<?php

declare(strict_types=1);

require_once __DIR__ . '/_storage_admin.php';
require_once __DIR__ . '/../../library/TenantStorageConfig.php';
require_once __DIR__ . '/../../library/CloudProviderRegistry.php';

use Oaaoai\Core\CloudProviderRegistry;
use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantStorageConfig;

/**
 * GET/POST /api/storage_settings — tenant blob backend configuration.
 */
return function (): void {
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $ctx = oaao_core_storage_require_admin($this);
    if ($ctx === null) {
        return;
    }

    $pdo = $ctx['pdo'];
    $tenantId = $ctx['tenant_id'];

    if ($method === 'GET') {
        try {
            $config = TenantStorageConfig::load($pdo, $tenantId);
            $st = $pdo->prepare('SELECT slug FROM oaao_tenant WHERE tenant_id = ? LIMIT 1');
            $st->execute([$tenantId]);
            $slug = trim((string) ($st->fetchColumn() ?: ''));
            echo json_encode([
                'success' => true,
                'data'    => TenantStorageConfig::publicPayload($config, $slug !== '' ? $slug : null),
            ], JSON_UNESCAPED_UNICODE);
        } catch (\Throwable $e) {
            http_response_code(500);
            echo json_encode([
                'success' => false,
                'message' => 'Could not load storage settings',
                'detail'  => $e->getMessage(),
            ], JSON_UNESCAPED_UNICODE);
        }

        return;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $patch = [];
    if (isset($input['settings_mode']) && \is_string($input['settings_mode'])) {
        $patch['settings_mode'] = $input['settings_mode'];
    }
    if (isset($input['default']) && \is_array($input['default'])) {
        $patch['default'] = $input['default'];
    }
    if (isset($input['basic']) && \is_array($input['basic'])) {
        $patch['basic'] = $input['basic'];
    }
    if (isset($input['cloud_providers']) && \is_array($input['cloud_providers'])) {
        $patch['cloud_providers'] = $input['cloud_providers'];
    }
    if (isset($input['cloud_providers_remove']) && \is_array($input['cloud_providers_remove'])) {
        $patch['cloud_providers_remove'] = $input['cloud_providers_remove'];
    }
    if (isset($input['domains']) && \is_array($input['domains'])) {
        $patch['domains'] = $input['domains'];
    }
    if (isset($input['migration']) && \is_array($input['migration'])) {
        $patch['migration'] = $input['migration'];
    }

    if ($patch === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'settings_mode, default, basic, cloud_providers, domains, or migration required']);

        return;
    }

    $current = TenantStorageConfig::load($pdo, $tenantId);

    if (isset($patch['cloud_providers']) && \is_array($patch['cloud_providers'])) {
        $previewProviders = CloudProviderRegistry::mergeProviders($current, $patch['cloud_providers']);
        foreach ($patch['cloud_providers'] as $id => $row) {
            if (! \is_string($id) || ! \is_array($row)) {
                continue;
            }
            $normId = CloudProviderRegistry::normalizeId($id);
            $mergedRow = $previewProviders[$normId] ?? $row;
            $err = CloudProviderRegistry::validateProvider(\is_array($mergedRow) ? $mergedRow : $row);
            if ($err !== null) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => $err, 'provider_id' => $normId]);

                return;
            }
        }
    }

    $preview = TenantStorageConfig::mergeConfig($current, $patch);
    $mode = TenantStorageConfig::settingsMode($preview);

    if ($mode === TenantStorageConfig::MODE_AUTO) {
        $basicRow = TenantStorageConfig::activeDomainConfig($preview, StorageDomain::VAULT);
        $err = TenantStorageConfig::validateBasicConfig($basicRow);
        if ($err !== null) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => $err, 'field' => 'basic']);

            return;
        }
    } elseif (isset($patch['domains']) && \is_array($patch['domains'])) {
        foreach ($patch['domains'] as $domain => $cfg) {
            if (! \is_array($cfg)) {
                continue;
            }
            $err = TenantStorageConfig::validateDomainConfig(
                array_merge(
                    TenantStorageConfig::domainConfig($current, (string) $domain),
                    $cfg,
                ),
            );
            if ($err !== null) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => $err, 'domain' => $domain]);

                return;
            }
        }
    }

    if ($mode === TenantStorageConfig::MODE_AUTO && isset($patch['settings_mode'])) {
        $patch['domains'] = [];
    }

    try {
        $saved = TenantStorageConfig::save($pdo, $tenantId, $patch);
        $st = $pdo->prepare('SELECT slug FROM oaao_tenant WHERE tenant_id = ? LIMIT 1');
        $st->execute([$tenantId]);
        $slug = trim((string) ($st->fetchColumn() ?: ''));
    } catch (\Throwable $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => TenantStorageConfig::publicPayload($saved, $slug !== '' ? $slug : null),
    ], JSON_UNESCAPED_UNICODE);
};
