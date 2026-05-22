<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_container_create — create a folder under a vault root or existing folder.
 *
 * JSON body: {@code vault_id} (required), {@code name} (required),
 * optional {@code parent_container_id} (omit/null = vault root),
 * optional {@code workspace_id} (shell scope gate, see {@see oaao_vault_require_pg_api_context}).
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
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id is required.']);

        return;
    }

    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($name === '' || \strlen($name) > 120) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Folder name must be 1–120 characters.']);

        return;
    }

    $parentRaw = $body['parent_container_id'] ?? null;
    $parentId = null;
    if ($parentRaw !== null && $parentRaw !== '') {
        $parentId = (int) $parentRaw;
        if ($parentId < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid parent_container_id.']);

            return;
        }
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    if ($parentId !== null && ! $this->oaao_vault_container_belongs_to_vault($db, $parentId, $vaultId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parent folder does not belong to this vault.']);

        return;
    }

    $ts = date('Y-m-d H:i:s');
    $db->insert('vault_container', ['vault_id', 'name', 'parent_container_id', 'created_by', 'created_at', 'updated_at'])
        ->assign([
            'vault_id'           => $vaultId,
            'name'               => $name,
            'parent_container_id'=> $parentId,
            'created_by'         => $uid,
            'created_at'         => $ts,
            'updated_at'         => null,
        ])
        ->query();
    $newId = $db->lastID();
    if ($newId < 1) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not create folder']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => ['container_id' => $newId],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
