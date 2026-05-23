<?php



declare(strict_types=1);



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

    $purposeKey = isset($body['purpose_key']) ? trim((string) $body['purpose_key']) : '';
    if ($purposeKey !== '') {
        if ($meta === null) {
            $meta = [];
        }
        if (! isset($meta['purpose_key']) || trim((string) $meta['purpose_key']) === '') {
            $meta['purpose_key'] = $purposeKey;
        }
    }



    $core = $this->api('core');

    if (! $core) {

        http_response_code(503);

        echo json_encode(['success' => false, 'message' => 'Core unavailable']);



        return;

    }



    if ($eventKind === 'chat.completion' && \is_array($meta)) {

        $userId = isset($meta['user_id']) ? (int) $meta['user_id'] : (isset($body['user_id']) ? (int) $body['user_id'] : 0);

        $core->recordUsageChatCompletion($pdo, $tenantId, $meta, $userId > 0 ? $userId : null);

        echo json_encode(['success' => true]);



        return;

    }



    $userId = isset($body['user_id']) ? (int) $body['user_id'] : 0;

    $core->recordUsageEvent($pdo, $tenantId, $eventKind, $quantity, $unit, $meta, $userId > 0 ? $userId : null);

    echo json_encode(['success' => true]);

};

