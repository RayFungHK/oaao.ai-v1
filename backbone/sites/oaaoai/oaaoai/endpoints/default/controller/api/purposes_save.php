<?php

declare(strict_types=1);

use oaaoai\endpoints\AsrPurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;


/**
 * POST /endpoints/api/purposes_save — upsert {@code oaao_purpose}.
 *
 * Body JSON: id?, purpose_key, label, description?, default_endpoint_id?, is_enabled?, sort_order?, meta_json?
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    if (! $this->oaao_endpoints_canonical_is_pgsql($db)) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Purposes are stored on the PostgreSQL canonical database only. Switch auth database.driver to pgsql.',
        ]);

        return;
    }

    require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $id = isset($input['id']) && $input['id'] !== '' ? (int) $input['id'] : 0;
    $purposeKey = trim((string) ($input['purpose_key'] ?? ''));
    $label = trim((string) ($input['label'] ?? ''));
    $description = isset($input['description']) ? trim((string) $input['description']) : '';
    $defaultEndpointRaw = $input['default_endpoint_id'] ?? null;
    $defaultEndpointId = null;
    if ($defaultEndpointRaw !== null && $defaultEndpointRaw !== '') {
        $defaultEndpointId = (int) $defaultEndpointRaw;
        if ($defaultEndpointId < 1) {
            $defaultEndpointId = null;
        }
    }
    $isEnabled = isset($input['is_enabled']) ? ((int) (bool) $input['is_enabled']) : 1;
    $sortOrder = isset($input['sort_order']) ? (int) $input['sort_order'] : 500;
    $metaJson = $input['meta_json'] ?? null;
    if ($metaJson !== null && $metaJson !== '') {
        if (is_array($metaJson)) {
            try {
                $metaJson = json_encode($metaJson, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'meta_json must be valid JSON']);

                return;
            }
        } else {
            $metaJson = trim((string) $metaJson);
            if ($metaJson !== '') {
                json_decode($metaJson, true);
                if (json_last_error() !== JSON_ERROR_NONE) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'message' => 'meta_json must be valid JSON']);

                    return;
                }
            }
        }
    } else {
        $metaJson = null;
    }

    if ($purposeKey === '' || $label === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'purpose_key and label are required']);

        return;
    }

    if (! preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/', $purposeKey)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'purpose_key must start with alphanumeric and use only letters, digits, ._:-',
        ]);

        return;
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

    if ($defaultEndpointId !== null && ! $repo->endpointRowExists($defaultEndpointId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'default_endpoint_id does not reference an endpoint']);

        return;
    }

    $metaArray = AsrPurposeConfig::decodePurposeMeta($metaJson);
    if (AsrPurposeConfig::requiresBuiltInFunasr($metaArray)) {
        $chat = $this->api('chat');
        if (! $chat || $chat->getOrchestratorInternalBase() === '') {
            http_response_code(503);
            echo json_encode([
                'success' => false,
                'message' => 'Speaker mode requires the orchestrator. Configure OAAO_ORCHESTRATOR_INTERNAL_URL.',
            ]);

            return;
        }
        $status = $chat->orchestratorFunasrStatus();
        if ($status === null || empty($status['ready'])) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'Built-in FunASR is not ready. Wait for image download and smoke test to pass before saving Speaker mode.',
            ]);

            return;
        }
    }

    $now = gmdate('Y-m-d H:i:s');

    try {
        if ($id > 0) {
            if (! $repo->purposeRowExists($id)) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Purpose not found']);

                return;
            }

            $repo->updatePurpose([
                'purpose_key'          => $purposeKey,
                'label'                => $label,
                'description'          => $description !== '' ? $description : null,
                'default_endpoint_id'   => $defaultEndpointId,
                'is_enabled'           => $isEnabled,
                'sort_order'           => $sortOrder,
                'meta_json'            => $metaJson,
                'updated_at'           => $now,
                'id'                   => $id,
            ]);
            echo json_encode(['success' => true, 'id' => $id], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

            return;
        }

        $newId = $repo->insertPurpose([
            'purpose_key'          => $purposeKey,
            'label'                => $label,
            'description'          => $description !== '' ? $description : null,
            'default_endpoint_id'   => $defaultEndpointId,
            'is_enabled'           => $isEnabled,
            'sort_order'           => $sortOrder,
            'meta_json'            => $metaJson,
            'created_at'           => $now,
            'updated_at'           => $now,
        ]);
        echo json_encode(['success' => true, 'id' => $newId], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        if (str_contains(strtolower($e->getMessage()), 'unique')) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'purpose_key already exists']);

            return;
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to save purpose']);
    }
};
