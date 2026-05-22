<?php

declare(strict_types=1);

use Oaaoai\Core\TenantRepository;

/**
 * POST /platform/api/tenants_save — create or update a customer tenant + host bindings.
 *
 * JSON: {@code tenant_id?}, {@code slug}, {@code display_name?}, {@code signup_mode?}, {@code status?},
 * {@code limits_json?}, {@code hosts} (string[]).
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

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    try {
        $tenantIdIn = isset($body['tenant_id']) ? (int) $body['tenant_id'] : 0;
        if ($tenantIdIn < 1) {
            $body['kind'] = 'customer';
        }
        $saved = TenantRepository::saveTenant($pdo, $body);
        $tenantId = (int) ($saved['tenant_id'] ?? 0);

        /** @var list<string> $hosts */
        $hosts = [];
        if (isset($body['hosts']) && \is_array($body['hosts'])) {
            foreach ($body['hosts'] as $h) {
                if (\is_string($h) && trim($h) !== '') {
                    $hosts[] = trim($h);
                }
            }
        }
        if ($hosts !== []) {
            TenantRepository::replaceHosts($pdo, $tenantId, $hosts);
        }

        $row = TenantRepository::resolveById($pdo, $tenantId);
        if (\is_array($row)) {
            $row['hosts'] = TenantRepository::listHostsForTenant($pdo, $tenantId);
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'tenant'  => $row,
                'created' => (bool) ($saved['created'] ?? false),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not save tenant']);
    }
};
