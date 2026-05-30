<?php

declare(strict_types=1);

use oaaoai\chat\ChatEndpointsRepository;

/**
 * POST /chat/api/chat_endpoints_save — upsert {@code oaao_chat_endpoint} + replace {@code oaao_chat_endpoint_llm} rows.
 *
 * Body JSON: id?, name, type (single|tree|ddtree), is_enabled?, is_default?, profile_version?, config_json?, llms: [{ endpoint_id, role }]
 */
return function (): void {
    $db = $this->oaao_chat_require_admin();
    if (! $db) {
        return;
    }

    $this->ensureChatProfileTables($db);

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $id = isset($input['id']) && $input['id'] !== '' ? (int) $input['id'] : 0;
    $name = trim((string) ($input['name'] ?? ''));
    $typeRaw = strtolower(trim((string) ($input['type'] ?? 'single')));
    $type = match ($typeRaw) {
        'tree', 'tot', 'thought_tree' => 'tree',
        'ddtree', 'dd_tree' => 'ddtree',
        default => 'single',
    };
    $isEnabled = isset($input['is_enabled']) ? ((int) (bool) $input['is_enabled']) : 1;
    $isDefault = isset($input['is_default']) ? ((int) (bool) $input['is_default']) : 0;
    $profileVersion = trim((string) ($input['profile_version'] ?? ''));

    $configPayload = $input['config_json'] ?? null;
    $repo = new ChatEndpointsRepository($db, $this->api('core'));
    $existingJson = null;
    if ($id > 0) {
        $existing = $repo->getProfile($id);
        if ($existing === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Profile not found']);

            return;
        }
        $existingJson = isset($existing['config_json']) ? (string) $existing['config_json'] : null;
    }

    try {
        $configJson = oaao_chat_profile_merge_config_json($existingJson, $configPayload, $profileVersion);
    } catch (\InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);

        return;
    }

    /** @var list<array{endpoint_id: int, role: string}> $llmNorm */
    $llmNorm = [];
    $llmsIn = $input['llms'] ?? [];
    if (! \is_array($llmsIn)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'llms must be an array']);

        return;
    }
    foreach ($llmsIn as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $eid = (int) ($row['endpoint_id'] ?? 0);
        $role = strtolower(trim((string) ($row['role'] ?? '')));
        if ($eid > 0 && $role !== '') {
            $llmNorm[] = ['endpoint_id' => $eid, 'role' => $role];
        }
    }

    if ($type === 'single') {
        $pick = null;
        foreach ($llmNorm as $row) {
            if ($row['role'] === 'default') {
                $pick = $row;
                break;
            }
        }
        if ($pick === null && isset($llmNorm[0])) {
            $pick = ['endpoint_id' => $llmNorm[0]['endpoint_id'], 'role' => 'default'];
        }
        $llmNorm = $pick !== null ? [$pick] : [];
        if ($llmNorm === [] || $llmNorm[0]['endpoint_id'] < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Single-path profile requires one LLM (role default)']);

            return;
        }
    } else {
        /** @var array<string, int> $byRole */
        $byRole = [];
        foreach ($llmNorm as $row) {
            $byRole[$row['role']] = $row['endpoint_id'];
        }
        foreach (['hint', 'expand', 'judge'] as $need) {
            if (! isset($byRole[$need]) || $byRole[$need] < 1) {
                http_response_code(400);
                echo json_encode([
                    'success' => false,
            'message' => 'Multi-stage profile (思維樹 / DDTree) requires 提示·展開·評判 LLM bindings',
                ]);

                return;
            }
        }
        $llmNorm = [
            ['endpoint_id' => $byRole['hint'], 'role' => 'hint'],
            ['endpoint_id' => $byRole['expand'], 'role' => 'expand'],
            ['endpoint_id' => $byRole['judge'], 'role' => 'judge'],
        ];
    }

    if ($name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'name is required']);

        return;
    }

    $auth = $this->api('auth');
    $user = $auth ? $auth->getUser() : null;
    $createdBy = $user ? (int) $user->user_id : null;

    $now = gmdate('Y-m-d H:i:s');

    try {
        $newId = $repo->saveProfile(
            $id,
            $name,
            $type,
            $isEnabled,
            $isDefault,
            $configJson,
            $createdBy,
            $now,
            $llmNorm,
        );
        echo json_encode(['success' => true, 'id' => $newId], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    } catch (\Throwable $e) {
        error_log(sprintf('[chat_endpoints_save] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to save chat endpoint']);
    }
};

/**
 * @param mixed $configPayload
 */
function oaao_chat_profile_merge_config_json(?string $existingJson, $configPayload, string $profileVersion): ?string
{
    $meta = [];
    if (\is_array($configPayload)) {
        $meta = $configPayload;
    } elseif (\is_string($configPayload) && trim($configPayload) !== '') {
        try {
            $d = json_decode($configPayload, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($d)) {
                $meta = $d;
            }
        } catch (\JsonException) {
            throw new \InvalidArgumentException('config_json must be valid JSON');
        }
    } elseif ($existingJson !== null && trim($existingJson) !== '') {
        try {
            $d = json_decode($existingJson, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($d)) {
                $meta = $d;
            }
        } catch (\JsonException) {
            $meta = [];
        }
    }

    if ($profileVersion !== '') {
        $meta['profile_version'] = $profileVersion;
    }

    if ($meta === []) {
        return null;
    }

    foreach (
        [
            'temperature'               => [0.0, 2.0],
            'fast_judgment_threshold'   => [0.0, 1.0],
        ] as $cfgKey => [$lo, $hi]
    ) {
        if (! \array_key_exists($cfgKey, $meta)) {
            continue;
        }
        $v = $meta[$cfgKey];
        if (! is_numeric($v)) {
            unset($meta[$cfgKey]);

            continue;
        }
        $meta[$cfgKey] = round(max($lo, min($hi, (float) $v)), 4);
    }

    return json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
