<?php

declare(strict_types=1);

use oaaoai\chat\ChatHistorySettings;

/**
 * GET /chat/api/chat_preferences — tenant chat defaults (read-only for chat UI).
 * POST /chat/api/chat_preferences — administrator saves tenant defaults ({@code oaao_tenant.limits_json.chat}).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if ($method === 'POST') {
        $db = $this->oaao_chat_require_admin();
        if (! $db instanceof \Razy\Database) {
            return;
        }
        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return;
        }

        $input = json_decode(file_get_contents('php://input'), true) ?: [];
        $patch = [];
        if (isset($input['history_page_size'])) {
            $patch['history_page_size'] = (int) $input['history_page_size'];
        }
        if (isset($input['prompt_message_limit'])) {
            $patch['prompt_message_limit'] = (int) $input['prompt_message_limit'];
        }
        if ($patch === []) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'history_page_size or prompt_message_limit required']);

            return;
        }

        $core = $this->api('core');
        $tenantId = $core ? $core->tenantContextId() : 0;
        if ($tenantId < 1) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Tenant context unavailable']);

            return;
        }

        $saved = ChatHistorySettings::saveTenantChatConfig($pdo, $tenantId, $patch);
        echo json_encode([
            'success' => true,
            'data'    => ChatHistorySettings::publicLimitsPayloadFromConfig($saved),
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($method !== 'GET') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    [$authApi, $authUser] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $authUser) {
        return;
    }

    $uid = (int) ($authUser->user_id ?? 0);
    $pdo = $this->oaao_chat_canonical_pdo();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $input = $_GET;
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $core = $this->api('core');
    if ($core) {
        $core->bootstrapTenantContext($pdo);
    }

    $config = ChatHistorySettings::resolveTenantChatConfig($pdo);
    echo json_encode([
        'success' => true,
        'data'    => ChatHistorySettings::publicLimitsPayloadFromConfig($config),
    ], JSON_UNESCAPED_UNICODE);
};
