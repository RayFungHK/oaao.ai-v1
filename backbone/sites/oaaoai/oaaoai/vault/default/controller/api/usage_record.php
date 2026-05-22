<?php

declare(strict_types=1);

use Oaaoai\Core\UsageEventRepository;

/**
 * POST /vault/api/usage_record — orchestrator usage ledger ({@code X-OAAO-Internal-Token}).
 *
 * JSON: {@code tenant_id}, {@code event_kind}, {@code quantity?}, {@code unit?}, {@code meta?}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! $this->oaao_vault_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $ctx = $this->oaao_vault_sidecar_pg_context();
    if ($ctx === null) {
        return;
    }
    $pdo = $ctx['pdo'];

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $tenantId = isset($body['tenant_id']) ? (int) $body['tenant_id'] : 0;
    if ($tenantId < 1) {
        $tenantId = (int) ($ctx['tid'] ?? 0);
    }
    $eventKind = isset($body['event_kind']) ? trim((string) $body['event_kind']) : '';

    if ($tenantId < 1 || $eventKind === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'tenant_id and event_kind required']);

        return;
    }

    $quantity = isset($body['quantity']) && is_numeric($body['quantity']) ? (float) $body['quantity'] : null;
    $unit = isset($body['unit']) ? trim((string) $body['unit']) : null;
    $meta = isset($body['meta']) && \is_array($body['meta']) ? $body['meta'] : null;

    require_once dirname(__DIR__, 4) . '/core/default/library/UsageEventRepository.php';

    if ($eventKind === 'chat.completion' && \is_array($meta)) {
        UsageEventRepository::recordChatCompletion($pdo, $tenantId, $meta);
        echo json_encode(['success' => true]);

        return;
    }

    UsageEventRepository::record($pdo, $tenantId, $eventKind, $quantity, $unit, $meta);
    echo json_encode(['success' => true]);
};
