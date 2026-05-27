<?php

declare(strict_types=1);

require_once __DIR__ . '/_storage_admin.php';
require_once __DIR__ . '/../../library/TenantStorageConfig.php';
require_once __DIR__ . '/../../library/StorageDomain.php';
require_once __DIR__ . '/../../library/StorageOrchestratorClient.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageOrchestratorClient;
use Oaaoai\Core\TenantStorageConfig;

/**
 * POST /api/storage_test — verify domain backend connectivity.
 */
return function (): void {
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? '')) !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_core_storage_require_admin($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $domain = isset($input['domain']) ? trim((string) $input['domain']) : StorageDomain::VAULT;
    if (! StorageDomain::isValid($domain)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid domain']);

        return;
    }

    $config = TenantStorageConfig::load($ctx['pdo'], $ctx['tenant_id']);
    $domainCfg = TenantStorageConfig::activeDomainConfig($config, $domain);
    if (isset($input['domain_config']) && \is_array($input['domain_config'])) {
        $domainCfg = TenantStorageConfig::resolveDomainConfig($config, array_merge($domainCfg, $input['domain_config']));
    }

    $err = TenantStorageConfig::validateDomainConfig($domainCfg);
    if ($err !== null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $err]);

        return;
    }

    $backend = strtolower(trim((string) ($domainCfg['backend'] ?? 'local')));
    if ($backend === 'local') {
        $root = StorageDomain::defaultLocalRoot($domain);
        $writable = is_dir($root) || @mkdir($root, 0775, true);
        echo json_encode([
            'success' => true,
            'data'    => ['backend' => 'local', 'local_root' => $root, 'writable' => $writable],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $resp = StorageOrchestratorClient::post('test', [
        'tenant_id'     => $ctx['tenant_id'],
        'domain'        => $domain,
        'domain_config' => $domainCfg,
        'locator'       => ['backend' => $backend, 'key' => '__probe/ping.txt'],
    ], 90);

    if (! \is_array($resp) || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Storage test failed',
            'detail'  => \is_array($resp) ? ($resp['detail'] ?? $resp) : null,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode(['success' => true, 'data' => $resp], JSON_UNESCAPED_UNICODE);
};
