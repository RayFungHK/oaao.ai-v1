<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Blocks customer-product APIs (chat, vault, workspace) on the platform admin host.
 */
final class PlatformProductGuard
{
    public static function rejectCustomerProductApi(?\PDO $pdo = null): void
    {
        require_once __DIR__ . '/TenantContext.php';
        if ($pdo instanceof \PDO) {
            TenantContext::bootstrap($pdo);
        }

        if (! TenantContext::isPlatform()) {
            return;
        }

        http_response_code(403);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode([
            'success' => false,
            'message' => 'Customer product APIs are not available on the platform admin host',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
