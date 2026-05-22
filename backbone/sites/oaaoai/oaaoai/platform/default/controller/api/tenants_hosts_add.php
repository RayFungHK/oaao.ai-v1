<?php

declare(strict_types=1);

use Oaaoai\Core\TenantRepository;

/**
 * POST /platform/api/tenants_hosts_add — append host bindings to a tenant.
 *
 * JSON: {@code tenant_id}, {@code hosts} (string[]).
 */
return function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $db = $this->oaao_platform_require_pg();
    if ($db === null) {
        return;
    }

    $raw = file_get_contents('php://input');
    /** @var array<string, mixed> $body */
    $body = [];
    if (\is_string($raw) && trim($raw) !== '') {
        $dec = json_decode($raw, true);
        if (\is_array($dec)) {
            $body = $dec;
        }
    }

    $tenantId = isset($body['tenant_id']) ? (int) $body['tenant_id'] : 0;
    if ($tenantId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'tenant_id required']);

        return;
    }

    /** @var list<string> $hosts */
    $hosts = [];
    if (isset($body['hosts']) && \is_array($body['hosts'])) {
        foreach ($body['hosts'] as $h) {
            if (\is_string($h) && trim($h) !== '') {
                $hosts[] = trim($h);
            }
        }
    }
    if ($hosts === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'hosts required']);

        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    try {
        $row = TenantRepository::resolveById($pdo, $tenantId);
        if ($row === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Tenant not found']);

            return;
        }

        $added = TenantRepository::addHosts($pdo, $tenantId, $hosts);
        $row['hosts'] = TenantRepository::listHostsForTenant($pdo, $tenantId);

        echo json_encode([
            'success' => true,
            'data'    => [
                'tenant'      => $row,
                'added_hosts' => $added,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\InvalidArgumentException $e) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not add hosts']);
    }
};
