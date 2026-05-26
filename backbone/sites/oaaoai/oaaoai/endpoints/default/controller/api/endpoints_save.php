<?php

declare(strict_types=1);

use oaaoai\endpoints\AsrLivePurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * POST /endpoints/api/endpoints_save — upsert {@code oaao_endpoint}.
 *
 * Body JSON: id?, name, endpoint_type? (string or comma-separated list), base_url?, model, api_key_ref?, is_enabled?, config_json?
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $id = isset($input['id']) && $input['id'] !== '' ? (int) $input['id'] : 0;
    $name = trim((string) ($input['name'] ?? ''));
    $endpointTypeRaw = $input['endpoint_type'] ?? 'chat';
    /** @var list<string> $endpointParts */
    $endpointParts = [];
    if (\is_array($endpointTypeRaw)) {
        foreach ($endpointTypeRaw as $p) {
            $t = trim((string) $p);
            if ($t !== '') {
                $endpointParts[] = $t;
            }
        }
    } else {
        foreach (explode(',', (string) $endpointTypeRaw) as $p) {
            $t = trim($p);
            if ($t !== '') {
                $endpointParts[] = $t;
            }
        }
    }
    $endpointParts = array_values(array_unique($endpointParts));
    $endpointType = $endpointParts === [] ? 'chat' : implode(',', $endpointParts);
    $baseUrl = isset($input['base_url']) ? trim((string) $input['base_url']) : '';
    if ($baseUrl !== '' && \in_array('asr.live', $endpointParts, true)) {
        $wsUrl = AsrLivePurposeConfig::coerceWebSocketUrl($baseUrl);
        if ($wsUrl !== '') {
            $baseUrl = $wsUrl;
        }
    }
    $model = trim((string) ($input['model'] ?? ''));
    $apiKeyRef = isset($input['api_key_ref']) ? trim((string) $input['api_key_ref']) : '';
    $isEnabled = isset($input['is_enabled']) ? ((int) (bool) $input['is_enabled']) : 1;
    $configJson = $input['config_json'] ?? null;
    if ($configJson !== null && $configJson !== '') {
        if (is_array($configJson)) {
            try {
                $configJson = json_encode($configJson, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'config_json must be valid JSON']);

                return;
            }
        } else {
            $configJson = trim((string) $configJson);
            if ($configJson !== '') {
                json_decode($configJson, true);
                if (json_last_error() !== JSON_ERROR_NONE) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'message' => 'config_json must be valid JSON']);

                    return;
                }
            }
        }
    } else {
        $configJson = null;
    }

    if ($name === '' || $model === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'name and model are required']);

        return;
    }

    $now = gmdate('Y-m-d H:i:s');

    try {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        if ($id > 0) {
            if (! $repo->endpointRowExists($id)) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Endpoint not found']);

                return;
            }

            $repo->updateEndpoint([
                'name'           => $name,
                'endpoint_type'  => $endpointType,
                'base_url'       => $baseUrl !== '' ? $baseUrl : null,
                'model'          => $model,
                'api_key_ref'    => $apiKeyRef !== '' ? $apiKeyRef : null,
                'is_enabled'     => $isEnabled,
                'config_json'    => $configJson,
                'updated_at'     => $now,
                'id'             => $id,
            ]);
            echo json_encode(['success' => true, 'id' => $id], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

            return;
        }

        $newId = $repo->insertEndpoint([
            'name'           => $name,
            'endpoint_type'  => $endpointType,
            'base_url'       => $baseUrl !== '' ? $baseUrl : null,
            'model'          => $model,
            'api_key_ref'    => $apiKeyRef !== '' ? $apiKeyRef : null,
            'is_enabled'     => $isEnabled,
            'config_json'    => $configJson,
            'created_at'     => $now,
            'updated_at'     => $now,
        ]);
        echo json_encode(['success' => true, 'id' => $newId], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to save endpoint']);
    }
};
