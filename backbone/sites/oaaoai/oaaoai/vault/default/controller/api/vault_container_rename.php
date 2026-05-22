<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_container_rename — rename a folder.
 *
 * JSON body: {@code vault_id}, {@code container_id}, {@code name}, optional {@code workspace_id}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    $containerId = isset($body['container_id']) ? (int) $body['container_id'] : 0;
    if ($vaultId < 1 || $containerId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id and container_id are required.']);

        return;
    }

    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($name === '' || \strlen($name) > 120) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Folder name must be 1–120 characters.']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    if (! $this->oaao_vault_container_belongs_to_vault($db, $containerId, $vaultId)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Folder not found.']);

        return;
    }

    $ts = date('Y-m-d H:i:s');
    $db->update('vault_container', ['name', 'updated_at'])
        ->where('id=:cid, vault_id=:vid')
        ->assign([
            'name'       => $name,
            'updated_at' => $ts,
            'cid'        => $containerId,
            'vid'        => $vaultId,
        ])
        ->query();

    echo json_encode(
        ['success' => true, 'data' => ['container_id' => $containerId, 'name' => $name]],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
