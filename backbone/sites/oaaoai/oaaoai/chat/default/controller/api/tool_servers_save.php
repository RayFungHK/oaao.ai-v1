<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\endpoints\ToolServerRegister;
use oaaoai\endpoints\ToolServerStorage;

/**
 * POST /chat/api/tool_servers_save — administrator: replace persisted tool servers JSON.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    require_once dirname(__DIR__, 4) . '/endpoints/default/library/ToolServerStorage.php';
    require_once dirname(__DIR__, 4) . '/endpoints/default/library/ToolServerRegister.php';

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $raw = $input['servers'] ?? $input['tool_servers'] ?? null;
    if (! \is_array($raw)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Expected servers[] array'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $enriched = ChatOrchestratorApi::postInternalJson('/v1/admin/tools/enrich_openapi', ['servers' => $raw], 60);
    if (\is_array($enriched) && \is_array($enriched['servers'] ?? null)) {
        $raw = $enriched['servers'];
    }

    $normalized = [];
    foreach ($raw as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? ''));
        $base = trim((string) ($row['base_url'] ?? ''));
        if ($id === '' || $base === '') {
            continue;
        }
        $purposes = $row['allowed_purposes'] ?? ['chat', 'planning'];
        if (! \is_array($purposes)) {
            $purposes = array_map('trim', explode(',', (string) $purposes));
        }
        $entry = [
            'id'                => $id,
            'base_url'          => $base,
            'label'             => trim((string) ($row['label'] ?? $id)),
            'openapi_url'       => trim((string) ($row['openapi_url'] ?? '/openapi.json')),
            'allowed_purposes'  => array_values(array_filter(array_map('strval', $purposes))),
        ];
        if (isset($row['openapi_spec']) && \is_array($row['openapi_spec'])) {
            $entry['openapi_spec'] = $row['openapi_spec'];
        }
        $normalized[] = $entry;
    }

    if (! ToolServerStorage::savePersisted($normalized)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not write tool servers file'], JSON_UNESCAPED_UNICODE);

        return;
    }

    ToolServerStorage::savePersisted($normalized);

    ToolServerRegister::clearForReload();
    ToolServerStorage::resetBootstrap();
    $this->trigger('collect_feature_registries')->resolve([]);
    ToolServerStorage::bootstrapPersisted();

    echo json_encode([
        'success' => true,
        'data'    => [
            'servers' => ToolServerRegister::allSorted(),
            'path'    => ToolServerStorage::configPath(),
        ],
    ], JSON_UNESCAPED_UNICODE);
};
